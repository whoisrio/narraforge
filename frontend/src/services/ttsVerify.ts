/**
 * TTS 语音核对（ASR 回读验收）—— 前端编排层。
 *
 * 设计文档：docs/superpowers/specs/2026-10-15-tts-asr-verify-design.md
 * 比对逻辑唯一实现在后端（app/services/tts_verify_service.py）；本模块只做：
 * - 状态判定（resolveVerificationView：audio_key 作废 → 按未核对处理）
 * - 幂等选择（selectVerifySegments：只补未核对 / 过期 / error 的段）
 * - 单段编排（verifyOne：取 blob → verify 请求 → audio_key 守卫 → 结果）
 * - 批量编排（verifyBatch：串行 + 心跳 + run 联动 + 503 中断 + 取消）
 * - in-flight 登记（挡同段并发：手动按钮 / 自动重核与批量撞车）
 *
 * 音频 blob 的获取依赖存储模式（backend=HTTP fetch / frontend=IndexedDB），
 * 由页面注入 getAudioBlob——本模块不感知存储模式。
 */
import type {
  Chapter,
  Segment,
  SegmentVerification,
  VerifyRunRecord,
} from '../types';
import { ttsVerifyApi } from './api';

/** 单段核对默认超时（project.configs.verify_timeout_seconds 可覆盖）。
 * 后端冷启动首段要加载 FunASR 模型，慢盘可能超时——该段标 error，重试即可。 */
export const VERIFY_TIMEOUT_MS_DEFAULT = 60_000;

/** 心跳过时阈值：3 × 默认单段超时（与后端 HEARTBEAT_STALE_SECONDS 对齐）。 */
export const HEARTBEAT_STALE_MS = 180_000;

/** verify 接口响应（后端 tts_verify_service.verify_texts + 元信息） */
export interface VerifyResponse {
  asr_text: string;
  normalized_baseline: string;
  normalized_asr: string;
  similarity: number;
  match: boolean;
  diff: SegmentVerification['diff'];
  engine: string;
  device?: string;
  elapsed_ms?: number;
}

/** 核对目标：段 + 所属章（backend 模式取音频要拼章节路径） */
export interface VerifySegmentTarget {
  segmentId: string;
  chapterId: string;
}

/** 取段音频 blob；取不到（文件丢失/无音频/取 blob 抛错）返回 null */
export type GetAudioBlob = (segment: Segment, chapterId: string) => Promise<Blob | null>;

/** 核对请求依赖（默认实现走 ttsVerifyApi；测试可注入） */
export interface TtsVerifyDeps {
  getAudioBlob: GetAudioBlob;
  requestVerify: (
    blob: Blob,
    baselineText: string,
    opts: { timeoutMs: number },
  ) => Promise<VerifyResponse>;
  now: () => number;
}

/** 批量编排可注入的 run 依赖（默认走 ttsVerifyApi） */
export interface VerifyBatchDeps extends TtsVerifyDeps {
  createRun: (body: {
    project_id: string;
    scope: 'chapter' | 'project';
    chapter_id?: string | null;
    total: number;
  }) => Promise<VerifyRunRecord>;
  patchRun: (
    runId: string,
    body: { done?: number; status?: 'running' | 'completed' | 'stopped' },
  ) => Promise<VerifyRunRecord>;
}

// ---------------------------------------------------------------------------
// 状态判定（渲染层统一函数）
// ---------------------------------------------------------------------------

/** 核对结果绑定的音频标识：IndexedDB 音频 id 优先，backend 模式用 path。 */
export function verificationAudioKey(segment: Segment): string | undefined {
  return segment.audio.current?.id ?? segment.audio.current?.path;
}

export type EffectiveVerificationState =
  | 'unverified'
  | SegmentVerification['status'];

export interface VerificationView {
  state: EffectiveVerificationState;
  /** true = verification 存在但 audio_key 不匹配（音频已重新生成）——
   * 一律按「未核对」处理，角标可显示「已过期」提示。 */
  stale: boolean;
  verification: SegmentVerification | null;
}

/**
 * 有效状态 =
 *   无 verification                        → 未核对
 *   verification.audio_key ≠ 当前 audio_key → 未核对（stale，可显示「已过期」）
 *   否则                                   → verification.status
 */
export function resolveVerificationView(segment: Segment): VerificationView {
  const v = segment.verification;
  if (!v) return { state: 'unverified', stale: false, verification: null };
  const currentKey = verificationAudioKey(segment);
  if (!currentKey || v.audio_key !== currentKey) {
    return { state: 'unverified', stale: true, verification: v };
  }
  return { state: v.status, stale: false, verification: v };
}

/** 「只看不一致」过滤判定：仅新鲜 mismatch 入选。 */
export function isMismatchVisible(segment: Segment): boolean {
  return resolveVerificationView(segment).state === 'mismatch';
}

// ---------------------------------------------------------------------------
// 核对报告（批量完成后弹出的汇总数据，纯函数组装）
// ---------------------------------------------------------------------------

/** 报告条目：本次 run 发现的需人工处理段（mismatch / error） */
export interface VerifyReportItem {
  segmentId: string;
  chapterId: string;
  chapterName: string;
  /** 章内 1-based 序号（与列表 #idx 一致） */
  segmentIndex: number;
  displayText: string;
  verification: SegmentVerification;
}

/** 批量核对报告数据（VerifyReportModal 的输入） */
export interface VerifyReportData {
  scope: 'chapter' | 'project';
  /** 本次 run 的目标段数（含跳过） */
  total: number;
  /** 本次 run 实际写回结果的段数（段被删则不计） */
  verified: number;
  matchCount: number;
  mismatchCount: number;
  errorCount: number;
  items: VerifyReportItem[];
}

/**
 * 从 run 结果组装报告：计数分类 + 挑出 mismatch/error 段（带章节名/段序号/显示文本）。
 * run 期间被删除的段（chapters 里找不到）只计 verified，不进 items。
 */
export function buildVerifyReport(params: {
  scope: 'chapter' | 'project';
  total: number;
  results: Map<string, SegmentVerification>;
  chapters: Chapter[];
}): VerifyReportData {
  const { scope, total, results, chapters } = params;

  let matchCount = 0;
  let mismatchCount = 0;
  let errorCount = 0;
  const items: VerifyReportItem[] = [];

  for (const [segmentId, verification] of results) {
    let chapter: Chapter | undefined;
    let index = -1;
    for (const ch of chapters) {
      const idx = ch.segments.findIndex((s) => s.id === segmentId);
      if (idx >= 0) {
        chapter = ch;
        index = idx;
        break;
      }
    }
    if (!chapter || index < 0) continue; // run 期间被删：无呈现载体，跳过
    if (verification.status === 'match') { matchCount++; continue; }
    if (verification.status === 'mismatch') mismatchCount++;
    else if (verification.status === 'error') errorCount++;
    else continue; // ignored 等非 run 产出状态不进报告
    items.push({
      segmentId,
      chapterId: chapter.id,
      chapterName: chapter.name,
      segmentIndex: index + 1,
      displayText: chapter.segments[index].text,
      verification,
    });
  }

  // 章节位置 → 段位置稳定排序，与列表顺序一致
  const chapterOrder = new Map(chapters.map((ch, i) => [ch.id, ch.position ?? i]));
  items.sort((a, b) => {
    const ca = chapterOrder.get(a.chapterId) ?? 0;
    const cb = chapterOrder.get(b.chapterId) ?? 0;
    return ca !== cb ? ca - cb : a.segmentIndex - b.segmentIndex;
  });

  return {
    scope,
    total,
    verified: results.size,
    matchCount,
    mismatchCount,
    errorCount,
    items,
  };
}

// ---------------------------------------------------------------------------
// 幂等选择（数据层防重闸门）
// ---------------------------------------------------------------------------

/**
 * 筛需要核对的段：有效状态为「未核对（无 verification 或 audio_key 不匹配）/
 * error」的段；已有新鲜结果（match / mismatch / ignored 且 audio_key 匹配）跳过。
 *
 * 重复点全量核对、中断后再点，都自动变成「只补没核对的」——天然续跑，不重烧 ASR。
 * 未合成段（无音频）也纳入：执行期取不到 blob 会标 error，如实反馈。
 */
export function selectVerifySegments(chapters: Chapter[]): VerifySegmentTarget[] {
  const targets: VerifySegmentTarget[] = [];
  for (const ch of chapters) {
    for (const seg of ch.segments) {
      const view = resolveVerificationView(seg);
      if (view.state === 'unverified' || view.state === 'error') {
        targets.push({ segmentId: seg.id, chapterId: ch.id });
      }
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// in-flight 登记（同窗口并发闸门 + 「核对中」角标数据源）
// ---------------------------------------------------------------------------

const inFlight = new Map<string, number>();

/** 同段已在核对中 → false（调用方跳过，不重复烧 ASR）。 */
function beginInFlight(segmentId: string): boolean {
  if (inFlight.has(segmentId)) return false;
  inFlight.set(segmentId, Date.now());
  return true;
}

function endInFlight(segmentId: string): void {
  inFlight.delete(segmentId);
}

/** 「核对中」角标判定（内存态，不持久化）。 */
export function isSegmentVerifying(segmentId: string): boolean {
  return inFlight.has(segmentId);
}

/** @internal 测试清理 */
export function endAllInFlight(): void {
  inFlight.clear();
}

// ---------------------------------------------------------------------------
// 错误分类
// ---------------------------------------------------------------------------

/** 503（funasr 不可用）/ 404（workers 部署未挂载）属于环境级错误：
 * 单段上抛，批量场景直接中断整批。 */
export class VerifyEnvironmentError extends Error {
  constructor(message = 'verify environment unavailable') {
    super(message);
    this.name = 'VerifyEnvironmentError';
  }
}

/** 409（已有活跃 run）：整批不启动。 */
export class VerifyRunInProgressError extends Error {
  run: VerifyRunRecord | null;
  constructor(run: VerifyRunRecord | null) {
    super('verify run in progress');
    this.name = 'VerifyRunInProgressError';
    this.run = run;
  }
}

/** axios 把 AbortSignal.timeout 的中止包装成 CanceledError（name
 * 'CanceledError' / code 'ERR_CANCELED'）；本流程中取消只可能来自超时信号
 * （批量取消只停循环，不掐单段在途请求），统一按超时归类。 */
function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  const code = (err as { code?: string } | null)?.code;
  return name === 'TimeoutError' || code === 'ERR_CANCELED' || name === 'CanceledError';
}

function isEnvironmentError(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  return status === 503 || status === 404;
}

// ---------------------------------------------------------------------------
// verifyOne：单段编排
// ---------------------------------------------------------------------------

export interface VerifyOneOptions {
  getAudioBlob: GetAudioBlob;
  /** 基准文本 = 实际朗读文本（页面用 resolveSegmentEngineText 预先算好） */
  baselineText: string;
  /** 该段当前 audio_key 的实时读取（核对中途重新 TTS 会变化 → 丢弃结果） */
  getCurrentAudioKey?: () => string | undefined;
  timeoutMs?: number;
  now?: () => number;
  requestVerify?: TtsVerifyDeps['requestVerify'];
}

function errorVerification(
  audioKey: string,
  baselineText: string,
  message: string,
  now: () => number,
): SegmentVerification {
  return {
    audio_key: audioKey,
    status: 'error',
    baseline_text: baselineText,
    asr_text: '',
    engine: 'funasr',
    error: message,
    checked_at: new Date(now()).toISOString(),
  };
}

function toVerification(
  resp: VerifyResponse,
  audioKey: string,
  baselineText: string,
  now: () => number,
): SegmentVerification {
  return {
    audio_key: audioKey,
    status: resp.match ? 'match' : 'mismatch',
    baseline_text: baselineText,
    asr_text: resp.asr_text,
    similarity: resp.similarity,
    match: resp.match,
    diff: resp.diff,
    engine: resp.engine,
    checked_at: new Date(now()).toISOString(),
  };
}

/**
 * 核对单段：取音频 → 调 verify → audio_key 守卫 → 返回核对结果。
 *
 * 返回 null 表示结果被丢弃（audio_key 已变）或 in-flight 跳过——调用方不写段。
 * 503/404 上抛 VerifyEnvironmentError（环境级，由调用方中断批量/提示）。
 */
export async function verifyOne(
  segment: Segment,
  chapterId: string,
  options: VerifyOneOptions,
): Promise<SegmentVerification | null> {
  const requestVerify = options.requestVerify ?? defaultRequestVerify;
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS_DEFAULT;

  if (!beginInFlight(segment.id)) return null;
  try {
    const audioKeyAtStart = verificationAudioKey(segment) ?? '';
    let blob: Blob | null = null;
    try {
      blob = await options.getAudioBlob(segment, chapterId);
    } catch {
      blob = null; // 文件丢失（file_exists=false）等 → 走 error 分支
    }
    if (!blob) {
      return errorVerification(audioKeyAtStart, options.baselineText, 'audio unavailable', now);
    }
    let resp: VerifyResponse;
    try {
      resp = await requestVerify(blob, options.baselineText, { timeoutMs });
    } catch (err) {
      if (isEnvironmentError(err)) throw new VerifyEnvironmentError();
      if (isTimeoutError(err)) {
        return errorVerification(audioKeyAtStart, options.baselineText, 'verify timeout', now);
      }
      const message = err instanceof Error ? err.message : String(err);
      return errorVerification(audioKeyAtStart, options.baselineText, message, now);
    }
    // 核对结果返回时 audio_key 已变（核对中途用户重 TTS）→ 直接丢弃不写
    const currentKey = options.getCurrentAudioKey?.() ?? audioKeyAtStart;
    if (currentKey !== audioKeyAtStart) return null;
    return toVerification(resp, audioKeyAtStart, options.baselineText, now);
  } finally {
    endInFlight(segment.id);
  }
}

// ---------------------------------------------------------------------------
// verifyBatch：批量串行编排 + run 联动
// ---------------------------------------------------------------------------

export interface VerifyBatchOptions {
  projectId: string;
  getAudioBlob: GetAudioBlob;
  /** 实时读段（选择快照后可能被手动核对/自动重核改写；段被删则返回 undefined） */
  getSegment: (target: VerifySegmentTarget) => Segment | undefined;
  /** 该段当前 audio_key 实时读取（audio_key 守卫用；缺省用快照段自身） */
  getCurrentAudioKey?: (segmentId: string) => string | undefined;
  /** 每段基准文本（页面按 resolveSegmentEngineText 现算） */
  resolveBaselineText: (segment: Segment, chapterId: string) => string;
  timeoutMs?: number;
  /** run 联动（默认开；单段核对不走批量，不建 run） */
  run?: { scope: 'chapter' | 'project'; chapterId?: string | null };
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, current: VerifySegmentTarget) => void;
  onSegmentStart?: (segmentId: string) => void;
  onSegmentEnd?: (segmentId: string, verification: SegmentVerification | null) => void;
  createRun?: VerifyBatchDeps['createRun'];
  patchRun?: VerifyBatchDeps['patchRun'];
  requestVerify?: TtsVerifyDeps['requestVerify'];
}

export interface VerifyBatchResult {
  /** 已处理段数（写回 + 跳过 + 段消失；取消前已完成的也计入） */
  completed: number;
  skipped: number;
  stopped: boolean;
}

/**
 * 串行核对一批段。FunASR 后端推理锁本来就是串行，前端并发只会堆请求。
 *
 * - 开始 POST /runs（409 → 整批不启动）；每完成一段 PATCH 心跳；
 *   正常结束 completed，取消/503 中断 stopped。
 * - 每段执行前再查有效状态（执行期幂等）：已有新鲜结果跳过并计 done。
 * - 单个失败（含超时）标 error 继续下一段；503 环境级错误直接中断整批。
 */
export async function verifyBatch(
  targets: VerifySegmentTarget[],
  options: VerifyBatchOptions,
): Promise<VerifyBatchResult> {
  const createRun = options.createRun ?? defaultCreateRun;
  const patchRun = options.patchRun ?? defaultPatchRun;
  const requestVerify = options.requestVerify ?? defaultRequestVerify;
  const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS_DEFAULT;

  const total = targets.length;
  let run: VerifyRunRecord | null = null;
  if (options.run) {
    // 防重闸门：409 → 整批不启动（调用方 toast「核对已在进行中」）
    run = await createRun({
      project_id: options.projectId,
      scope: options.run.scope,
      chapter_id: options.run.chapterId ?? null,
      total,
    });
  }

  let done = 0;
  let skipped = 0;
  let stopped = false;

  const heartbeat = async (status?: 'completed' | 'stopped') => {
    if (!run) return;
    try {
      await patchRun(run.id, { done, ...(status ? { status } : {}) });
    } catch {
      // 心跳失败不影响核对本身（孤儿 run 由后端惰性判活兜底）
    }
  };

  try {
    for (const target of targets) {
      if (options.signal?.aborted) {
        stopped = true;
        break;
      }
      const segment = options.getSegment(target);
      if (!segment) {
        // 段在 live 态已消失（被删）：计 done 继续
        done++;
        skipped++;
        options.onProgress?.(done, total, target);
        await heartbeat();
        continue;
      }
      // 执行期再查有效状态：已有新鲜结果（含选择快照后的手动核对）跳过
      const view = resolveVerificationView(segment);
      if (view.state === 'match' || view.state === 'mismatch' || view.state === 'ignored') {
        done++;
        skipped++;
        options.onProgress?.(done, total, target);
        await heartbeat();
        continue;
      }
      options.onSegmentStart?.(segment.id);
      const verification = await verifyOne(segment, target.chapterId, {
        getAudioBlob: options.getAudioBlob,
        baselineText: options.resolveBaselineText(segment, target.chapterId),
        getCurrentAudioKey: () =>
          options.getCurrentAudioKey?.(segment.id) ?? verificationAudioKey(segment),
        timeoutMs,
        requestVerify,
      });
      options.onSegmentEnd?.(segment.id, verification);
      done++;
      options.onProgress?.(done, total, target);
      await heartbeat();
    }
  } catch (err) {
    // 503 环境级错误：中断整批，run 标 stopped（不逐段标 error）
    await heartbeat('stopped');
    throw err;
  }

  await heartbeat(stopped ? 'stopped' : 'completed');
  return { completed: done, skipped, stopped };
}

// ---------------------------------------------------------------------------
// 默认依赖实现（api 层）
// ---------------------------------------------------------------------------

const defaultRequestVerify: TtsVerifyDeps['requestVerify'] = async (blob, baselineText, opts) => {
  try {
    return await ttsVerifyApi.verify(blob, baselineText, {
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    // AbortSignal.timeout 的中止经 axios 变成 CanceledError——归一成
    // TimeoutError，让 verifyOne 的超时分支统一处理。
    if ((err as { code?: string })?.code === 'ERR_CANCELED' || (err as { name?: string })?.name === 'CanceledError') {
      const timeout = new Error('verify timeout');
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    throw err;
  }
};
const defaultCreateRun: VerifyBatchDeps['createRun'] = (body) => ttsVerifyApi.createRun(body);
const defaultPatchRun: VerifyBatchDeps['patchRun'] = (runId, body) => ttsVerifyApi.patchRun(runId, body);
