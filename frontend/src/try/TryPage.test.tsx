import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/api')>();
  return {
    ...original,
    ttsApi: {
      getEdgeVoices: vi.fn(),
      synthesize: vi.fn(),
    },
  };
});

// 包一层 spy：默认仍走真实 IndexedDB；打包下载等用例需要真实 Blob
// （fake-indexeddb 会把 Blob 结构化克隆成空对象），可临时 mockResolvedValue。
vi.mock('./tryHistory', async (importOriginal) => {
  const original = await importOriginal<typeof import('./tryHistory')>();
  return {
    ...original,
    listTryTTSRecords: vi.fn(original.listTryTTSRecords),
  };
});

import { ttsApi } from '../services/api';
import { _openDB, _TTS_STORE } from '../services/indexedDB';
import { TryPage } from './TryPage';
import { listTryTTSRecords, saveTryTTSRecord } from './tryHistory';

const mockedListRecords = vi.mocked(listTryTTSRecords);
import { resetDownloadUpsellCounter } from './tryUpsell';
import type { TTSLocalRecord } from '../types';

const mockedGetEdgeVoices = vi.mocked(ttsApi.getEdgeVoices);
const mockedSynthesize = vi.mocked(ttsApi.synthesize);

function makeRecord(id: string, text = `record ${id}`): TTSLocalRecord {
  return {
    id,
    text,
    voice_id: 'en-US-AvaNeural',
    voice_name: 'Ava',
    audioBlob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
    audio_format: 'mp3',
    speed: 1,
    volume: 100,
    pitch: 1,
    instruction: '',
    language: 'English',
    created_at: new Date().toISOString(),
  };
}

/** 触发下载的真实实现被 stub，这里只暴露最近一次触发的下载文件名 */
let lastDownloadName: string | null = null;
/** createObjectURL 每次生成唯一 URL，便于断言旧 URL 的吊销时机 */
let objectUrlSeq = 0;
let playSpy: ReturnType<typeof vi.spyOn>;

async function renderPage() {
  render(<TryPage />);
  await waitFor(() => expect(mockedGetEdgeVoices).toHaveBeenCalled());
  await screen.findByRole('combobox', { name: /voice/i });
}

async function resetTTSStore() {
  const db = await _openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(_TTS_STORE, 'readwrite');
    tx.objectStore(_TTS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('TryPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    resetDownloadUpsellCounter();
    await resetTTSStore();
    lastDownloadName = null;
    objectUrlSeq = 0;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => `blob:mock-${++objectUrlSeq}`),
      revokeObjectURL: vi.fn(),
    });
    // jsdom 未实现媒体播放；autoplay 被浏览器拒绝时实现方需静默兜底
    playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    // 拦截 <a download> 点击，记录文件名
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      lastDownloadName = this.download;
    });
    mockedGetEdgeVoices.mockResolvedValue([
      { name: 'Ava', short_name: 'en-US-AvaNeural', display_name: 'Ava', gender: 'Female', locale: 'en-US', language: 'English' },
    ]);
    mockedSynthesize.mockResolvedValue({
      audio_id: 'a1',
      audio_base64: btoa('fake-audio'),
      audio_format: 'mp3',
      text: 'hello',
      voice_name: 'Ava',
      params: {},
    } as Awaited<ReturnType<typeof ttsApi.synthesize>>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('filters voice options by language and gender', async () => {
    mockedGetEdgeVoices.mockResolvedValue([
      { name: 'Ava', short_name: 'en-US-AvaNeural', display_name: 'Ava', gender: 'Female', locale: 'en-US', language: 'English' },
      { name: 'Andrew', short_name: 'en-US-AndrewNeural', display_name: 'Andrew', gender: 'Male', locale: 'en-US', language: 'English' },
      { name: 'Xiaoxiao', short_name: 'zh-CN-XiaoxiaoNeural', display_name: 'Xiaoxiao', gender: 'Female', locale: 'zh-CN', language: 'Chinese' },
    ]);
    await renderPage();

    // 默认 English：不含中文音色
    const voiceCombo = screen.getByRole('combobox', { name: /^voice$/i });
    expect(voiceCombo.textContent).toContain('Ava');
    expect(voiceCombo.textContent).not.toContain('Xiaoxiao');

    // 切到 Chinese
    fireEvent.change(screen.getByRole('combobox', { name: /language/i }), { target: { value: 'Chinese' } });
    expect(voiceCombo.textContent).toContain('Xiaoxiao');
    expect(voiceCombo.textContent).not.toContain('Ava');

    // 再按性别过滤
    fireEvent.change(screen.getByRole('combobox', { name: /language/i }), { target: { value: 'English' } });
    fireEvent.change(screen.getByRole('combobox', { name: /gender/i }), { target: { value: 'Male' } });
    expect(voiceCombo.textContent).toContain('Andrew');
    expect(voiceCombo.textContent).not.toContain('Ava');
  });

  it('filters voices without duplicating state across renders', async () => {
    await renderPage();
    expect(screen.getByRole('combobox', { name: /language/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /gender/i })).toBeInTheDocument();
  });

  it('shows char counter with the 3000 limit', async () => {
    await renderPage();
    expect(screen.getByTestId('char-count').textContent).toContain('3,000');
  });

  it('disables generate button when text is empty', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
  });

  it('rejects text over the limit', async () => {
    await renderPage();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a'.repeat(3001) } });
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
    expect(screen.getByText(/3,000 characters per generation/i)).toBeInTheDocument();
  });

  it('synthesizes, plays audio and adds a history record', async () => {
    await renderPage();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello world' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => expect(mockedSynthesize).toHaveBeenCalledWith(
      expect.objectContaining({ engine: 'edge_tts', edge_voice: 'en-US-AvaNeural', text: 'hello world' }),
    ));
    await screen.findByTestId('audio-player');
    const history = await listTryTTSRecords();
    expect(history).toHaveLength(1);
    expect(history[0].text).toBe('hello world');
    expect(screen.getByTestId('history-list').textContent).toContain('hello world');
  });

  it('autoplays the audio right after generation', async () => {
    await renderPage();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello world' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await screen.findByTestId('audio-player');
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
  });

  it('clicking Play on a history record loads it into the player and autoplays', async () => {
    await saveTryTTSRecord(makeRecord('r1'));
    await renderPage();
    await screen.findByText('record r1');
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));

    await screen.findByTestId('audio-player');
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
  });

  it('revokes the previous object URL only after switching to another recording', async () => {
    await saveTryTTSRecord(makeRecord('r1'));
    await saveTryTTSRecord(makeRecord('r2'));
    await renderPage();
    await screen.findByText('record r1');

    const playButtons = screen.getAllByRole('button', { name: /^play$/i });
    fireEvent.click(playButtons[0]);
    await screen.findByTestId('audio-player');
    const firstUrl = (screen.getByTestId('audio-player') as HTMLAudioElement).src;
    // 切换前：当前正在用的 URL 不能被吊销
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(firstUrl);

    fireEvent.click(playButtons[1]);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl));
    const secondUrl = (screen.getByTestId('audio-player') as HTMLAudioElement).src;
    expect(secondUrl).not.toBe(firstUrl);
    // 切换后再次播放，仍应自动开播
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it('retries once when voice list loading fails', async () => {
    mockedGetEdgeVoices
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([
        { name: 'Ava', short_name: 'en-US-AvaNeural', display_name: 'Ava', gender: 'Female', locale: 'en-US', language: 'English' },
      ]);
    render(<TryPage />);
    const combo = await screen.findByRole('combobox', { name: /voice/i });
    await waitFor(() => expect(combo.querySelectorAll('option')).toHaveLength(1));
    expect(mockedGetEdgeVoices).toHaveBeenCalledTimes(2);
  });

  it('falls back to fetching audio_url when no base64 (backend storage mode)', async () => {
    mockedSynthesize.mockResolvedValue({
      audio_id: 'srv1',
      audio_url: '/api/tts/audio/srv1',
      audio_format: 'mp3',
      text: 'hello',
      params: {},
    } as Awaited<ReturnType<typeof ttsApi.synthesize>>);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );

    await renderPage();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await screen.findByTestId('audio-player');
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/tts/audio/srv1'));
    const history = await listTryTTSRecords();
    expect(history).toHaveLength(1);
  });

  it('shows signup-oriented message on 429 rate limit', async () => {
    mockedSynthesize.mockRejectedValue({
      response: { data: { detail: { code: 'rate_limit_exceeded', limit: 50 } } },
    });
    await renderPage();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await screen.findByText(/daily free trial limit/i);
  });

  it('shows upsell dialog on every 5th download, others proceed directly', async () => {
    await saveTryTTSRecord(makeRecord('r1'));
    await renderPage();
    const downloadButton = await screen.findByRole('button', { name: /^download$/i });

    // 前 4 次下载直接触发，不弹确认
    for (let i = 0; i < 4; i++) {
      fireEvent.click(downloadButton);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(lastDownloadName).toMatch(/\.mp3$/);
    }

    // 第 5 次下载弹确认，继续后触发下载
    fireEvent.click(downloadButton);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/full version/i);
    fireEvent.click(screen.getByRole('button', { name: /continue download/i }));
    expect(lastDownloadName).toMatch(/\.mp3$/);

    // 确认后的 4 次又恢复直接下载
    for (let i = 0; i < 4; i++) {
      fireEvent.click(downloadButton);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }

    // 第 10 次再次弹窗
    fireEvent.click(downloadButton);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('downloads all history records as one zip', async () => {
    // 经 IDB 往返的 Blob 在 fake-indexeddb 下丢失方法，这里直接给内存记录（once：不泄漏到后续用例）
    mockedListRecords.mockResolvedValueOnce([makeRecord('r2'), makeRecord('r1')]);
    await renderPage();
    await screen.findByText('record r1');

    fireEvent.click(screen.getByRole('button', { name: /download all/i }));

    await waitFor(() => expect(lastDownloadName).toMatch(/\.zip$/));
    // 打包下载不弹推荐确认框
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deletes a single history record', async () => {
    await saveTryTTSRecord(makeRecord('r1'));
    await saveTryTTSRecord(makeRecord('r2'));
    await renderPage();
    await screen.findByText('record r1');

    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    fireEvent.click(deleteButtons[0]);

    await waitFor(async () => {
      expect(await listTryTTSRecords()).toHaveLength(1);
    });
  });

  it('clears all history after confirmation', async () => {
    await saveTryTTSRecord(makeRecord('r1'));
    await saveTryTTSRecord(makeRecord('r2'));
    await renderPage();
    await screen.findByText('record r1');

    fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/clear/i);
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(async () => {
      expect(await listTryTTSRecords()).toHaveLength(0);
    });
  });

  it('CTA stashes current text for the full app handoff', async () => {
    await renderPage();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my draft doc' } });
    fireEvent.click(screen.getByRole('button', { name: /try full version/i }));
    expect(sessionStorage.getItem('try_handoff_text')).toBe('my draft doc');
  });
});
