import type { SegmentedProject } from '../types';
import { getActiveChapter, type Action } from '../hooks/useSegmentedProject';
import type {
  ChapterPatchBody,
  ProjectPatchBody,
  SegmentPatchBody,
} from './api';

export type PersistentWrite =
  | { kind: 'project'; patch: ProjectPatchBody }
  | { kind: 'chapter'; chapterId: string; patch: ChapterPatchBody }
  | { kind: 'document'; document: 'source_document' | 'narration_script'; text: string }
  | { kind: 'segment'; chapterId: string; segmentId: string; patch: SegmentPatchBody };

function segmentPlacement(project: SegmentedProject, segmentId: string) {
  for (const chapter of project.chapters) {
    const segment = chapter.segments.find((s) => s.id === segmentId);
    if (segment) return { chapterId: chapter.id, segment };
  }
  return null;
}

function isCommittedLocally(action: Action): boolean {
  return 'touch' in action && action.touch === false;
}

/**
 * 把 reducer action 映射为服务端细粒度写入。
 *
 * 自动保存不再使用整包 PUT：项目字段 → PATCH project，章节字段 → PATCH chapter，
 * 文档 → PUT document，段字段 → PATCH segment。结构操作（增删/合并/拆分/排序）
 * 由调用方走 structure / create / reorder 端点，本函数不重复生成写。
 */
export function collectPersistentWrites(
  action: Action,
  _prev: SegmentedProject,
  next: SegmentedProject,
): PersistentWrite[] {
  if (isCommittedLocally(action)) return [];

  switch (action.type) {
    case 'RENAME_PROJECT':
      return [{ kind: 'project', patch: { name: action.name } }];
    case 'SET_LAYOUT':
      return [{ kind: 'project', patch: { layout: action.layout } }];
    case 'SET_PROJECT_NARRATOR':
      return [{ kind: 'project', patch: { default_narrator_role_id: action.roleId } }];
    case 'SET_PROJECT_META': {
      const patch: ProjectPatchBody = {
        configs: (next.configs ?? {}) as Record<string, unknown>,
      };
      if ('remotion_project_path' in action.meta) {
        patch.remotion_project_path = next.remotion_project_path ?? null;
      }
      return [{ kind: 'project', patch }];
    }
    case 'SET_SOURCE_DOCUMENT':
      return [{ kind: 'document', document: 'source_document', text: action.text }];
    case 'SET_NARRATION_SCRIPT':
      return [{ kind: 'document', document: 'narration_script', text: action.text }];

    case 'RENAME_CHAPTER':
      return [{ kind: 'chapter', chapterId: action.id, patch: { name: action.name } }];
    case 'SET_DEFAULT_PARAMS': {
      const chapter = getActiveChapter(next);
      return chapter
        ? [{ kind: 'chapter', chapterId: chapter.id, patch: { voice: action.params as unknown as Record<string, unknown> } }]
        : [];
    }
    case 'SET_ALL_CHAPTERS_PARAMS':
      return next.chapters.map((chapter) => ({
        kind: 'chapter',
        chapterId: chapter.id,
        patch: { voice: action.params as unknown as Record<string, unknown> },
      }));
    case 'SET_SPLIT_CONFIG': {
      const chapter = getActiveChapter(next);
      return chapter
        ? [{
            kind: 'chapter',
            chapterId: chapter.id,
            patch: { split_config: action.config as unknown as Record<string, unknown> },
          }]
        : [];
    }
    case 'SET_CHAPTER_META': {
      const chapter = getActiveChapter(next);
      if (!chapter) return [];
      const patch: ChapterPatchBody = {};
      if ('original_text' in action.meta) patch.original_text = chapter.original_text ?? null;
      if ('design_title' in action.meta) patch.design_title = chapter.design_title ?? null;
      return Object.keys(patch).length > 0
        ? [{ kind: 'chapter', chapterId: chapter.id, patch }]
        : [];
    }
    case 'SET_CHAPTER_META_BY_ID': {
      const chapter = next.chapters.find((c) => c.id === action.id);
      if (!chapter) return [];
      const patch: ChapterPatchBody = {};
      if ('original_text' in action.meta) patch.original_text = chapter.original_text ?? null;
      if ('design_title' in action.meta) patch.design_title = chapter.design_title ?? null;
      return Object.keys(patch).length > 0
        ? [{ kind: 'chapter', chapterId: action.id, patch }]
        : [];
    }

    case 'UPDATE_TEXT':
      return segmentWrite(next, action.id, { text: action.text });
    case 'UPDATE_PARAMS': {
      const placement = segmentPlacement(next, action.id);
      return placement
        ? [{
            kind: 'segment',
            chapterId: placement.chapterId,
            segmentId: action.id,
            patch: { voice: placement.segment.voice as unknown as Record<string, unknown> },
          }]
        : [];
    }
    case 'UPDATE_EMOTION':
      return segmentWrite(next, action.id, { emotion: action.emotion as string });
    case 'SET_SEGMENT_ROLE': {
      const placement = segmentPlacement(next, action.id);
      return placement
        ? [{
            kind: 'segment',
            chapterId: placement.chapterId,
            segmentId: action.id,
            patch: {
              role_id: placement.segment.role_id ?? null,
              voice: placement.segment.voice as unknown as Record<string, unknown>,
            },
          }]
        : [];
    }
    case 'SET_SEGMENT_KIND':
      return segmentWrite(next, action.id, { segment_kind: action.segmentKind });
    case 'TOGGLE_INDEPENDENT_VOICE': {
      const placement = segmentPlacement(next, action.id);
      return placement
        ? [{
            kind: 'segment',
            chapterId: placement.chapterId,
            segmentId: action.id,
            patch: { voice: placement.segment.voice as unknown as Record<string, unknown> },
          }]
        : [];
    }
    case 'UNLOCK_SEGMENT_AUDIO':
      return segmentWrite(next, action.id, { unlock_audio: true });
    case 'SET_SEGMENT_TEXT_TRANSFORMS':
      return segmentWrite(next, action.id, {
        text_transforms: action.transforms as unknown as Record<string, unknown> | undefined,
      });
    case 'SET_SEGMENT_VERIFICATION':
      return segmentWrite(next, action.id, {
        verification: action.verification as unknown as Record<string, unknown> | null,
      });
    case 'CLEAR_ROLE_FROM_SEGMENTS': {
      const writes: PersistentWrite[] = [];
      for (const chapter of _prev.chapters) {
        for (const segment of chapter.segments) {
          if (segment.role_id !== action.roleId) continue;
          writes.push({
            kind: 'segment',
            chapterId: chapter.id,
            segmentId: segment.id,
            patch: { role_id: null, voice: { source: 'chapter' } },
          });
        }
      }
      return writes;
    }

    // 结构操作走专用端点；纯 UI / 服务端自产字段的 action 不产生实体写。
    default:
      return [];
  }
}

function segmentWrite(
  project: SegmentedProject,
  segmentId: string,
  patch: SegmentPatchBody,
): PersistentWrite[] {
  const placement = segmentPlacement(project, segmentId);
  return placement
    ? [{ kind: 'segment', chapterId: placement.chapterId, segmentId, patch }]
    : [];
}
