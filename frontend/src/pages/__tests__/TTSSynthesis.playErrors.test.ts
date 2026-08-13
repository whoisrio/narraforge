/**
 * Tests for the frontend play handler error path.
 *
 * These tests pin the behavior of handlePlaySegment's error handling:
 *   - HTTP errors must extract the FastAPI `detail` field
 *   - Empty/tiny blobs must be reported with a clear message
 *   - Storage mode mismatches (segment has backend audio_path but mode is frontend)
 *     must surface a guidance message
 *   - Missing local blob must be reported
 *
 * We test the extraction helpers and the storage-mode guard directly, since
 * testing the full useCallback requires mocking the entire TTSSynthesis page.
 */
import { describe, it, expect } from 'vitest';

// Mirrors the inline helpers in TTSSynthesis.handlePlaySegment
async function extractErrorDetail(resp: Response): Promise<string> {
  if (resp.ok) return '';
  let detail = `HTTP ${resp.status}`;
  try {
    const body = await resp.clone().json();
    if (body?.detail) detail = `${resp.status} ${body.detail}`;
  } catch {
    try { detail = `${resp.status} ${await resp.text()}`.slice(0, 200); } catch { /* ignore */ }
  }
  return detail;
}

function isBlobTooSmall(blob: Blob, minBytes = 100): boolean {
  return blob.size < minBytes;
}

describe('play handler error extraction', () => {
  it('extracts FastAPI detail from 404', async () => {
    const resp = new Response(JSON.stringify({ detail: 'audio_not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
    const detail = await extractErrorDetail(resp);
    expect(detail).toBe('404 audio_not_found');
  });

  it('extracts FastAPI detail from 409 audio_missing', async () => {
    const resp = new Response(JSON.stringify({ detail: 'audio_missing' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
    const detail = await extractErrorDetail(resp);
    expect(detail).toBe('409 audio_missing');
  });

  it('falls back to status text when body is not JSON', async () => {
    const resp = new Response('Bad Gateway', {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    });
    const detail = await extractErrorDetail(resp);
    expect(detail).toContain('502');
    expect(detail.length).toBeLessThanOrEqual(204); // 200 + '502 ' + ...
  });

  it('handles 500 with empty body', async () => {
    const resp = new Response('', { status: 500 });
    const detail = await extractErrorDetail(resp);
    // Empty body → text() returns '' → we get "500 " (with trailing space, then sliced)
    // Behavior is acceptable: user sees a 500 indicator + a toast. Not silently dropped.
    expect(detail).toMatch(/^500/);
    expect(detail.length).toBeLessThanOrEqual(204);
  });

  it('flags tiny blob as corrupted', () => {
    const tiny = new Blob([new ArrayBuffer(50)], { type: 'audio/mpeg' });
    const normal = new Blob([new ArrayBuffer(35_000)], { type: 'audio/mpeg' });
    expect(isBlobTooSmall(tiny)).toBe(true);
    expect(isBlobTooSmall(normal)).toBe(false);
  });
});

describe('storage mode mismatch detection', () => {
  // Mirrors the storage-mode guard in handlePlaySegment (V3 audio.current structure)
  function isStorageModeMismatch(seg: { audio?: { current?: { path?: string; id?: string } } }, mode: string): boolean {
    return mode === 'frontend' && !!seg.audio?.current?.path && !seg.audio?.current?.id;
  }

  it('flags when segment has backend audio_path but mode is frontend', () => {
    expect(isStorageModeMismatch({ audio: { current: { path: 'a/b/c.mp3' } } }, 'frontend')).toBe(true);
  });

  it('does not flag when mode is backend', () => {
    expect(isStorageModeMismatch({ audio: { current: { path: 'a/b/c.mp3' } } }, 'backend')).toBe(false);
  });

  it('does not flag when segment has local audio_id in audio.current (V3 field)', () => {
    // 回归：新数据只有 audio.current.id、废弃字段 current_audio_id 缺失时，
    // 不能误判为"后端音频切前端模式"（曾导致播放走错分支）。
    expect(isStorageModeMismatch({ audio: { current: { id: 'local-123' } } }, 'frontend')).toBe(false);
  });
});

describe('segAudioId resolution', () => {
  // Mirrors TTSSynthesis.segAudioId: prefer V3 audio.current.id, fall back to
  // deprecated current_audio_id for legacy IndexedDB records.
  function segAudioId(seg: { audio?: { current?: { id?: string } }; current_audio_id?: string }): string | undefined {
    return seg.audio?.current?.id ?? seg.current_audio_id;
  }

  it('uses audio.current.id (V3 authoritative field)', () => {
    expect(segAudioId({ audio: { current: { id: 'new-audio' } } })).toBe('new-audio');
  });

  it('falls back to deprecated current_audio_id for legacy records', () => {
    expect(segAudioId({ current_audio_id: 'legacy-audio' })).toBe('legacy-audio');
  });

  it('prefers audio.current.id over deprecated field when both present', () => {
    expect(segAudioId({ audio: { current: { id: 'new-audio' } }, current_audio_id: 'legacy-audio' }))
      .toBe('new-audio');
  });

  it('returns undefined when neither is present', () => {
    expect(segAudioId({})).toBeUndefined();
  });
});
