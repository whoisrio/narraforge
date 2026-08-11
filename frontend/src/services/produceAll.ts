/** Pure planning helpers for the "一键制作全本" (produce-all) flow.

The orchestration (split -> reload -> sequential synth) lives in the
TTSSynthesis page; these functions are the testable, side-effect-free core:
which chapters need a rule split, and which segment ids to (re)synthesize.
*/
import type { Chapter } from '../types';

export type ProduceAllMode = 'unsynthesized' | 'all';

/** Live progress state for the "一键制作全本" (produce-all) run.
 * Null when no run is active (idle, completed, or stopped). */
export interface ProduceAllRun {
  running: boolean;
  mode: ProduceAllMode;
  total: number;
  done: number;
  currentSegmentId?: string;
  currentChapterName?: string;
  startedAt: number;
}

export interface ChapterSplitTarget {
  chapterId: string;
  text: string;
}

/** Chapters that have no segments yet and carry splittable narration text.

Text priority: ``narration_script`` (L2 rewrite) then ``original_text``
(source). Chapters without segments AND without text are skipped (nothing
to split). Chapters that already have segments are left alone so existing
segment-level voice overrides and audio are preserved.
*/
export function chaptersNeedingSplit(chapters: Chapter[]): ChapterSplitTarget[] {
  return chapters
    .filter((c) => c.segments.length === 0)
    .map((c) => ({
      chapterId: c.id,
      text: (c.narration_script || c.original_text || '').trim(),
    }))
    .filter((c) => c.text.length > 0);
}

/** Segment ids to (re)synthesize across the whole project.

Mirrors the per-chapter ``BatchSynthesizeMenu`` rules so "全本" behaves like
applying the chapter batch synth to every chapter:

- recorded segments are always skipped (locked, human audio protected);
- idle / failed segments are always targeted (never synthesized, or last
  attempt failed) - this also captures desynced segments whose audio file
  was lost (``enrichSegment`` drops them to ``idle`` via ``file_exists``);
- in ``all`` mode, ready segments are regenerated too, unless they are
  voice-locked (``voice.source === 'custom'``), matching the chapter menu;
- ``pending`` / ``queued`` segments are skipped (already in flight).
*/
export function selectProduceAllSegments(
  chapters: Chapter[],
  mode: ProduceAllMode,
): string[] {
  const ids: string[] = [];
  for (const ch of chapters) {
    for (const seg of ch.segments) {
      if (seg.audio.current?.origin === 'recorded') continue;
      if (seg.status === 'idle' || seg.status === 'failed') {
        ids.push(seg.id);
        continue;
      }
      if (mode === 'all' && seg.status === 'ready' && seg.voice.source !== 'custom') {
        ids.push(seg.id);
      }
    }
  }
  return ids;
}
