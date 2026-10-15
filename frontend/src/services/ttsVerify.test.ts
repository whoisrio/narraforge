/**
 * TTS 语音核对编排层测试。
 *
 * 覆盖设计文档要求的前端纯逻辑：
 * - selectVerifySegments 幂等选择（新鲜结果跳过、error/过期纳入）
 * - resolveVerificationView 状态判定（audio_key 作废 → 未核对 + stale）
 * - verifyOne 编排（audio_key 丢弃写入、in-flight 跳过、超时、503 上抛）
 * - verifyBatch 编排（执行期再查跳过、409 整批不启动、503 中断、取消、心跳）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Chapter, Segment, SegmentVerification, VerifyRunRecord } from '../types';
import {
  HEARTBEAT_STALE_MS,
  VERIFY_TIMEOUT_MS_DEFAULT,
  VerifyEnvironmentError,
  VerifyRunInProgressError,
  endAllInFlight,
  isSegmentVerifying,
  resolveVerificationView,
  selectVerifySegments,
  isMismatchVisible,
  verifyBatch,
  verifyOne,
  type GetAudioBlob,
  type VerifyBatchOptions,
  type VerifyResponse,
} from './ttsVerify';

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 's1',
    text: '保温杯可以装热水。',
    voice: { source: 'chapter' },
    status: 'ready',
    audio: { format: 'mp3', current: { id: 'aud-1', duration_sec: 2 } },
    segment_kind: 'narration',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeChapter(segments: Segment[], id = 'ch1'): Chapter {
  return {
    id,
    name: '第一章',
    voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural' },
    segments,
    split_config: { delimiters: ['。'], mode: 'rule' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function okResponse(asrText = '保温杯可以装热水', match = asrText === '保温杯可以装热水'): VerifyResponse {
  return {
    asr_text: asrText,
    normalized_baseline: '保温杯可以装热水',
    normalized_asr: asrText,
    similarity: match ? 1 : 0.2,
    match,
    diff: [{ op: 'equal', baseline: '保温杯可以装热水', asr: asrText }],
    engine: 'funasr',
    device: 'cpu',
    elapsed_ms: 10,
  };
}

function okBlob(): Promise<Blob | null> {
  return Promise.resolve(new Blob(['audio'], { type: 'audio/mpeg' }));
}

beforeEach(() => {
  endAllInFlight();
});

describe('resolveVerificationView（状态判定）', () => {
  it('no verification → unverified', () => {
    const view = resolveVerificationView(makeSegment());
    expect(view.state).toBe('unverified');
    expect(view.stale).toBe(false);
  });

  it('audio_key matches → verification.status', () => {
    const verification: SegmentVerification = {
      audio_key: 'aud-1', status: 'mismatch', baseline_text: 'a', asr_text: 'b',
      engine: 'funasr', checked_at: '2026-01-01T00:00:00Z',
    };
    const view = resolveVerificationView(makeSegment({ verification }));
    expect(view.state).toBe('mismatch');
    expect(view.stale).toBe(false);
    expect(view.verification).toEqual(verification);
  });

  it('audio_key mismatch → unverified + stale（重新 TTS 后旧结果作废）', () => {
    const verification: SegmentVerification = {
      audio_key: 'old-audio', status: 'ignored', baseline_text: 'a', asr_text: 'b',
      engine: 'funasr', checked_at: '2026-01-01T00:00:00Z',
    };
    const view = resolveVerificationView(makeSegment({ verification }));
    expect(view.state).toBe('unverified');
    expect(view.stale).toBe(true);
  });

  it('segment has no audio at all → unverified + stale', () => {
    const verification: SegmentVerification = {
      audio_key: 'old-audio', status: 'match', baseline_text: 'a', asr_text: 'a',
      engine: 'funasr', checked_at: '2026-01-01T00:00:00Z',
    };
    const view = resolveVerificationView(makeSegment({
      verification,
      audio: { format: 'mp3' },
    }));
    expect(view.state).toBe('unverified');
    expect(view.stale).toBe(true);
  });

  it('isMismatchVisible：仅新鲜 mismatch 可见', () => {
    const mismatch: SegmentVerification = {
      audio_key: 'aud-1', status: 'mismatch', baseline_text: 'a', asr_text: 'b',
      engine: 'funasr', checked_at: 't',
    };
    const staleMismatch: SegmentVerification = { ...mismatch, audio_key: 'old' };
    expect(isMismatchVisible(makeSegment({ verification: mismatch }))).toBe(true);
    expect(isMismatchVisible(makeSegment({ verification: staleMismatch }))).toBe(false);
    expect(isMismatchVisible(makeSegment())).toBe(false);
  });
});

describe('selectVerifySegments', () => {
  it('未核对 / error / 过期纳入，新鲜 match/mismatch/ignored 跳过', () => {
    const fresh = (status: SegmentVerification['status'], audioKey = 'aud-1'): SegmentVerification => ({
      audio_key: audioKey, status, baseline_text: 'a', asr_text: 'b', engine: 'funasr', checked_at: 't',
    });
    const chapters = [
      makeChapter([
        makeSegment({ id: 'idle-seg', status: 'idle', audio: { format: 'mp3' } }), // 未核对（无音频也纳入，执行期标 error）
        makeSegment({ id: 'fresh-match', verification: fresh('match') }),
        makeSegment({ id: 'fresh-mismatch', verification: fresh('mismatch') }),
        makeSegment({ id: 'fresh-ignored', verification: fresh('ignored') }),
        makeSegment({ id: 'err-seg', verification: fresh('error') }),
        makeSegment({ id: 'stale-seg', verification: fresh('match', 'old-key') }),
      ]),
      makeChapter([makeSegment({ id: 'other-chapter-seg' })], 'ch2'),
    ];
    expect(selectVerifySegments(chapters)).toEqual([
      { segmentId: 'idle-seg', chapterId: 'ch1' },
      { segmentId: 'err-seg', chapterId: 'ch1' },
      { segmentId: 'stale-seg', chapterId: 'ch1' },
      { segmentId: 'other-chapter-seg', chapterId: 'ch2' },
    ]);
  });

  it('空章节安全', () => {
    expect(selectVerifySegments([makeChapter([])])).toEqual([]);
  });
});

describe('verifyOne', () => {
  const baseOptions = () => ({
    getAudioBlob: okBlob as GetAudioBlob,
    baselineText: '保温杯可以装热水',
    getCurrentAudioKey: () => 'aud-1' as string | undefined,
  });

  it('成功 → 返回绑 audio_key 的核对结果', async () => {
    const verification = await verifyOne(makeSegment(), 'ch1', {
      ...baseOptions(),
      requestVerify: async () => okResponse(),
    });
    expect(verification).not.toBeNull();
    expect(verification!.audio_key).toBe('aud-1');
    expect(verification!.status).toBe('match');
    expect(verification!.baseline_text).toBe('保温杯可以装热水');
    expect(verification!.asr_text).toBe('保温杯可以装热水');
    expect(verification!.engine).toBe('funasr');
    expect(verification!.checked_at).toBeTruthy();
  });

  it('mismatch → status mismatch + 保留 diff', async () => {
    const verification = await verifyOne(makeSegment(), 'ch1', {
      ...baseOptions(),
      requestVerify: async () => okResponse('完全不同的回读'),
    });
    expect(verification!.status).toBe('mismatch');
    expect(verification!.match).toBe(false);
  });

  it('audio_key 已变 → 丢弃不写（核对中途用户重 TTS）', async () => {
    let currentKey: string | undefined = 'aud-1';
    const verification = await verifyOne(makeSegment(), 'ch1', {
      ...baseOptions(),
      getCurrentAudioKey: () => currentKey,
      requestVerify: async () => {
        currentKey = 'new-audio'; // 核对期间重新 TTS
        return okResponse();
      },
    });
    expect(verification).toBeNull();
  });

  it('取不到音频 blob → error 结果（audio unavailable）', async () => {
    const verification = await verifyOne(makeSegment(), 'ch1', {
      ...baseOptions(),
      getAudioBlob: async () => null,
      requestVerify: async () => okResponse(),
    });
    expect(verification!.status).toBe('error');
    expect(verification!.error).toBeTruthy();
  });

  it('取 blob 抛错 → error 结果', async () => {
    const verification = await verifyOne(makeSegment(), 'ch1', {
      ...baseOptions(),
      getAudioBlob: async () => { throw new Error('fs gone'); },
      requestVerify: async () => okResponse(),
    });
    expect(verification!.status).toBe('error');
  });

  it('请求超时 → error 结果（verify timeout）', async () => {
    const timeoutError = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
    const verification = await verifyOne(makeSegment(), 'ch1', {
      ...baseOptions(),
      requestVerify: async () => { throw timeoutError; },
    });
    expect(verification!.status).toBe('error');
    expect(verification!.error).toBe('verify timeout');
  });

  it('axios CanceledError（AbortSignal.timeout 的包裹形态）→ 归为超时', async () => {
    const canceled = Object.assign(new Error('canceled'), { name: 'CanceledError', code: 'ERR_CANCELED' });
    const verification = await verifyOne(makeSegment(), 'ch1', {
      ...baseOptions(),
      requestVerify: async () => { throw canceled; },
    });
    expect(verification!.status).toBe('error');
    expect(verification!.error).toBe('verify timeout');
  });

  it('503（引擎不可用）→ 上抛 VerifyEnvironmentError，不写段', async () => {
    await expect(verifyOne(makeSegment(), 'ch1', {
      ...baseOptions(),
      requestVerify: async () => {
        throw Object.assign(new Error('503'), { response: { status: 503 } });
      },
    })).rejects.toBeInstanceOf(VerifyEnvironmentError);
  });

  it('in-flight 登记：同段并发第二次调用直接跳过返回 null', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const opts = {
      ...baseOptions(),
      requestVerify: async () => { await gate; return okResponse(); },
    };
    const first = verifyOne(makeSegment(), 'ch1', opts);
    expect(isSegmentVerifying('s1')).toBe(true);
    const second = await verifyOne(makeSegment(), 'ch1', opts);
    expect(second).toBeNull(); // in-flight 挡住
    release();
    const result = await first;
    expect(result!.status).toBe('match');
    expect(isSegmentVerifying('s1')).toBe(false); // 完成后清理
  });

  it('传入 timeoutMs 透传给 requestVerify', async () => {
    const requestVerify = vi.fn(async () => okResponse());
    await verifyOne(makeSegment(), 'ch1', { ...baseOptions(), timeoutMs: 1234, requestVerify });
    expect(requestVerify).toHaveBeenCalledWith(
      expect.any(Blob), '保温杯可以装热水', expect.objectContaining({ timeoutMs: 1234 }),
    );
  });

  it('默认超时 60s', () => {
    expect(VERIFY_TIMEOUT_MS_DEFAULT).toBe(60_000);
  });
});

function makeRunRecord(status: VerifyRunRecord['status']): VerifyRunRecord {
  return {
    id: 'run-1', project_id: 'p1', scope: 'project', status,
    total: 10, done: 3,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('verifyBatch', () => {
  function makeBatchOptions(overrides: Partial<VerifyBatchOptions> = {}): VerifyBatchOptions {
    return {
      projectId: 'p1',
      getAudioBlob: okBlob,
      getSegment: (target) => ({ s1: makeSegment(), s2: makeSegment({ id: 's2' }) }[target.segmentId]),
      resolveBaselineText: (seg) => seg.text,
      ...overrides,
    };
  }

  it('串行核对全部目标并推进进度', async () => {
    const onProgress = vi.fn();
    const onSegmentEnd = vi.fn();
    const targets = [{ segmentId: 's1', chapterId: 'ch1' }, { segmentId: 's2', chapterId: 'ch1' }];
    const result = await verifyBatch(targets, makeBatchOptions({ onProgress, onSegmentEnd }));
    expect(result.stopped).toBe(false);
    expect(result.completed).toBe(2);
    expect(onProgress).toHaveBeenLastCalledWith(2, 2, expect.anything());
    expect(onSegmentEnd).toHaveBeenCalledTimes(2);
  });

  it('执行期已有新鲜结果 → 跳过但计 done（幂等续跑）', async () => {
    const requestVerify = vi.fn(async () => okResponse());
    const fresh = makeSegment({
      id: 's1',
      verification: {
        audio_key: 'aud-1', status: 'match', baseline_text: 'a', asr_text: 'a',
        engine: 'funasr', checked_at: 't',
      },
    });
    const result = await verifyBatch(
      [{ segmentId: 's1', chapterId: 'ch1' }],
      makeBatchOptions({ getSegment: () => fresh, requestVerify }),
    );
    expect(result.completed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(requestVerify).not.toHaveBeenCalled();
  });

  it('run 联动：创建 run → 每段心跳 → 完成 completed', async () => {
    const runs: VerifyRunRecord[] = [];
    const createRun = vi.fn(async () => { const r = makeRunRecord('running'); runs.push(r); return r; });
    const patchRun = vi.fn(async () => makeRunRecord('completed'));
    const targets = [{ segmentId: 's1', chapterId: 'ch1' }, { segmentId: 's2', chapterId: 'ch1' }];
    await verifyBatch(targets, makeBatchOptions({ run: { scope: 'project' }, createRun, patchRun }));
    expect(createRun).toHaveBeenCalledWith({ project_id: 'p1', scope: 'project', chapter_id: null, total: 2 });
    expect(patchRun).toHaveBeenCalledWith(runs[0].id, { done: 1 });
    expect(patchRun).toHaveBeenLastCalledWith(runs[0].id, { done: 2, status: 'completed' });
  });

  it('run 联动：chapter scope 带 chapter_id', async () => {
    const createRun = vi.fn(async () => makeRunRecord('running'));
    await verifyBatch(
      [{ segmentId: 's1', chapterId: 'ch9' }],
      makeBatchOptions({ run: { scope: 'chapter', chapterId: 'ch9' }, createRun }),
    );
    expect(createRun).toHaveBeenCalledWith({ project_id: 'p1', scope: 'chapter', chapter_id: 'ch9', total: 1 });
  });

  it('POST /runs 409 → 整批不启动（VerifyRunInProgressError），无任何核对请求', async () => {
    const requestVerify = vi.fn(async () => okResponse());
    const createRun = vi.fn(async () => {
      throw new VerifyRunInProgressError(makeRunRecord('running'));
    });
    await expect(verifyBatch(
      [{ segmentId: 's1', chapterId: 'ch1' }],
      makeBatchOptions({ run: { scope: 'project' }, createRun, requestVerify }),
    )).rejects.toBeInstanceOf(VerifyRunInProgressError);
    expect(requestVerify).not.toHaveBeenCalled();
  });

  it('单段 503 → 中断整批，run 标 stopped', async () => {
    let calls = 0;
    const requestVerify = vi.fn(async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('503'), { response: { status: 503 } });
      return okResponse();
    });
    const createRun = vi.fn(async () => makeRunRecord('running'));
    const patchRun = vi.fn(async () => makeRunRecord('stopped'));
    await expect(verifyBatch(
      [{ segmentId: 's1', chapterId: 'ch1' }, { segmentId: 's2', chapterId: 'ch1' }],
      makeBatchOptions({ run: { scope: 'project' }, requestVerify, createRun, patchRun }),
    )).rejects.toBeInstanceOf(VerifyEnvironmentError);
    expect(calls).toBe(1);
    expect(patchRun).toHaveBeenLastCalledWith('run-1', { done: 0, status: 'stopped' });
  });

  it('单段超时 → 该段标 error，批量继续下一段', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const requestVerify = vi.fn(async (_blob: Blob, text: string) => {
      if (text.includes('超时段')) throw timeoutError;
      return okResponse();
    });
    const getSegment = (t: { segmentId: string }) => {
      if (t.segmentId === 's1') return makeSegment({ id: 's1', text: '我是超时段' });
      return makeSegment({ id: 's2' });
    };
    const onSegmentEnd = vi.fn();
    const result = await verifyBatch(
      [{ segmentId: 's1', chapterId: 'ch1' }, { segmentId: 's2', chapterId: 'ch1' }],
      makeBatchOptions({ getSegment, requestVerify, onSegmentEnd }),
    );
    expect(result.completed).toBe(2);
    const first = onSegmentEnd.mock.calls[0][1] as SegmentVerification;
    expect(first.status).toBe('error');
    expect(first.error).toBe('verify timeout');
    const second = onSegmentEnd.mock.calls[1][1] as SegmentVerification;
    expect(second.status).toBe('match');
  });

  it('用户取消（signal abort）→ 已完成的保留，run 标 stopped', async () => {
    const controller = new AbortController();
    const createRun = vi.fn(async () => makeRunRecord('running'));
    const patchRun = vi.fn(async () => makeRunRecord('stopped'));
    const onSegmentEnd = vi.fn();
    const result = await verifyBatch(
      [{ segmentId: 's1', chapterId: 'ch1' }, { segmentId: 's2', chapterId: 'ch1' }],
      makeBatchOptions({
        run: { scope: 'project' },
        signal: controller.signal,
        createRun,
        patchRun,
        onSegmentEnd,
        requestVerify: async () => {
          controller.abort();
          return okResponse();
        },
      }),
    );
    expect(result.stopped).toBe(true);
    expect(result.completed).toBe(1); // 第一段完成，第二段未执行
    expect(onSegmentEnd).toHaveBeenCalledTimes(1);
    expect(patchRun).toHaveBeenLastCalledWith('run-1', { done: 1, status: 'stopped' });
  });

  it('目标段在 live 态已消失（被删）→ 计 done 继续', async () => {
    const result = await verifyBatch(
      [{ segmentId: 'gone', chapterId: 'ch1' }, { segmentId: 's2', chapterId: 'ch1' }],
      makeBatchOptions(),
    );
    expect(result.completed).toBe(2);
    expect(result.skipped).toBe(1);
  });

  it('心跳年龄新鲜度阈值 180s', () => {
    expect(HEARTBEAT_STALE_MS).toBe(180_000);
  });
});
