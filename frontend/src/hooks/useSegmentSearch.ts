/**
 * 全项目搜索（跨章节，纯前端：所有 segment 数据已在内存）。
 *
 * 两处消费：Studio 工具栏搜索框（SegmentSearchBar）与发音映射面板的
 * 「包含该词的 segment」列表（PronunciationMapPanel）——一份搜索逻辑两处用。
 */
import { useMemo } from 'react';
import type { SegmentedProject } from '../types';
import { UPPERCASE_WORD_RE } from '../services/textTransforms';

export interface SegmentSearchHit {
  chapterId: string;
  /** 优先 design_title（展示用标题），回退 name */
  chapterName: string;
  segmentId: string;
  position: number;
  /** 首个命中词的上下文片段（前后各 16 字，截断处加 …） */
  snippet: string;
  /** 该段命中次数 */
  matchCount: number;
}

const CONTEXT = 16;

function buildSnippet(text: string, start: number, length: number): string {
  const from = Math.max(0, start - CONTEXT);
  const to = Math.min(text.length, start + length + CONTEXT);
  return (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
}

/** 大小写不敏感子串匹配，跨全部章节；空查询返回空。 */
export function searchSegments(project: SegmentedProject, query: string): SegmentSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SegmentSearchHit[] = [];
  for (const ch of project.chapters) {
    ch.segments.forEach((seg, idx) => {
      const lower = seg.text.toLowerCase();
      const first = lower.indexOf(q);
      if (first < 0) return;
      let count = 0;
      let i = first;
      while (i >= 0) {
        count++;
        i = lower.indexOf(q, i + q.length);
      }
      hits.push({
        chapterId: ch.id,
        chapterName: ch.design_title || ch.name,
        segmentId: seg.id,
        position: seg.position ?? idx,
        snippet: buildSnippet(seg.text, first, q.length),
        matchCount: count,
      });
    });
  }
  return hits;
}

/** 含全大写拉丁词 [A-Z]{2,} 的段（与搜索同结果形状，供「含全大写词」快捷过滤器用）。 */
export function findUppercaseSegments(project: SegmentedProject): SegmentSearchHit[] {
  const re = new RegExp(UPPERCASE_WORD_RE.source, 'g');
  const hits: SegmentSearchHit[] = [];
  for (const ch of project.chapters) {
    ch.segments.forEach((seg, idx) => {
      const matches = [...seg.text.matchAll(re)];
      if (matches.length === 0) return;
      const first = matches[0];
      hits.push({
        chapterId: ch.id,
        chapterName: ch.design_title || ch.name,
        segmentId: seg.id,
        position: seg.position ?? idx,
        snippet: buildSnippet(seg.text, first.index ?? 0, first[0].length),
        matchCount: matches.length,
      });
    });
  }
  return hits;
}

/** 把片段按 query 的命中位置切开（大小写不敏感），供高亮渲染。 */
export function splitSnippet(snippet: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text: snippet, match: false }];
  const lower = snippet.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let i = 0;
  while (i < snippet.length) {
    const idx = lower.indexOf(q, i);
    if (idx < 0) {
      parts.push({ text: snippet.slice(i), match: false });
      break;
    }
    if (idx > i) parts.push({ text: snippet.slice(i, idx), match: false });
    parts.push({ text: snippet.slice(idx, idx + q.length), match: true });
    i = idx + q.length;
  }
  return parts;
}

/** hook 版：query 变化时重算（结果按 chapters 顺序稳定）。 */
export function useSegmentSearch(project: SegmentedProject, query: string): SegmentSearchHit[] {
  return useMemo(() => searchSegments(project, query), [project, query]);
}
