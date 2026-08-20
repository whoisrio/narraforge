import type { SegmentedProject } from '../types';
import { getActiveChapter } from '../hooks/useSegmentedProject';

/**
 * 把 Try 页接力文本应用到项目：仅当活动章节还没有任何内容
 * （无原文且无分段）时填入 original_text，其余情况原样返回。
 */
export function applyTryHandoffToProject(
  project: SegmentedProject,
  handoffText: string,
): SegmentedProject {
  if (!handoffText.trim()) return project;
  const chapter = getActiveChapter(project);
  if (!chapter) return project;
  if ((chapter.original_text ?? '').trim()) return project;
  if (chapter.segments.length > 0) return project;
  const now = new Date().toISOString();
  return {
    ...project,
    chapters: project.chapters.map((c) =>
      c.id === chapter.id ? { ...c, original_text: handoffText } : c,
    ),
    updated_at: now,
  };
}
