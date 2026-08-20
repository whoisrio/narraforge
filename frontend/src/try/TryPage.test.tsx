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

import { ttsApi } from '../services/api';
import { _openDB, _TTS_STORE } from '../services/indexedDB';
import { TryPage } from './TryPage';
import { listTryTTSRecords, saveTryTTSRecord } from './tryHistory';
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
    await resetTTSStore();
    lastDownloadName = null;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
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

  it('first download of a session shows upsell dialog, continue proceeds', async () => {
    await saveTryTTSRecord(makeRecord('r1'));
    await renderPage();
    const downloadButtons = await screen.findAllByRole('button', { name: /download/i });
    fireEvent.click(downloadButtons[0]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/full version/i);
    fireEvent.click(screen.getByRole('button', { name: /continue download/i }));
    expect(lastDownloadName).toMatch(/\.mp3$/);

    // 同一会话第二次下载不再弹窗
    fireEvent.click(downloadButtons[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(lastDownloadName).toMatch(/\.mp3$/);
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
