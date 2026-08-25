/**
 * 合成时文本变换（发音映射 + 大写转小写）。
 *
 * 与后端 backend/app/services/text_transform_service.py 互为镜像——
 * 修改任一侧的规则时必须同步另一侧（两侧测试用例一一对应）。
 *
 * 前端用途：映射面板/搜索结果里的「替换后效果」预览，以及 frontend 存储
 * 模式下本地合成前的文本变换；backend 存储模式由后端合成管道执行。
 * 原文（segment.text）、字幕、SRT 导出一律不受影响。
 */
import type { PronunciationMapEntry, SegmentTextTransforms } from '../types';

/**
 * 全大写拉丁词：至少 2 个连续大写字母，前后不紧邻 ASCII 字母/数字。
 * （排除 I、Http、HTTP2。）与后端 _UPPERCASE_WORD_RE 同规则。
 * 非 global 实例：需要全局匹配时用 new RegExp(UPPERCASE_WORD_RE.source, 'g')
 * 重建，避免共享正则的 lastIndex 状态污染。
 */
export const UPPERCASE_WORD_RE = /(?<![A-Za-z0-9])[A-Z]{2,}(?![A-Za-z0-9])/;

/**
 * 全局 ∪ 项目，以 source 为键；同 source 项目条目整体覆盖全局条目（含 id）。
 * 输出顺序 = Map 插入序（先全局后项目；被覆盖键保留原位），与后端 dict 语义一致。
 */
export function mergePronunciationMaps(
  globalMap: PronunciationMapEntry[] | null | undefined,
  projectMap: PronunciationMapEntry[] | null | undefined,
): PronunciationMapEntry[] {
  const merged = new Map<string, PronunciationMapEntry>();
  for (const e of globalMap ?? []) if (e.source) merged.set(e.source, e);
  for (const e of projectMap ?? []) if (e.source) merged.set(e.source, e);
  return [...merged.values()];
}

/**
 * 按 source 长度降序替换（Array.prototype.sort 稳定，与后端 sorted 一致）。
 * 单条目内不递归（target 含自身 source 不循环）；跨条目链式生效
 * （A 的 target 含 B 的 source 会被 B 再替换）——与后端语义一致。
 */
export function applyPronunciationMap(text: string, entries: PronunciationMapEntry[]): string {
  const ordered = [...entries].sort((a, b) => (b.source?.length ?? 0) - (a.source?.length ?? 0));
  let out = text;
  for (const e of ordered) {
    if (e.source) out = out.split(e.source).join(e.target ?? '');
  }
  return out;
}

/** 全大写拉丁词 [A-Z]{2,} 转小写（REST API 接口 → rest api 接口）。 */
export function lowercaseLatinWords(text: string): string {
  return text.replace(new RegExp(UPPERCASE_WORD_RE.source, 'g'), (m) => m.toLowerCase());
}

/** 段级覆盖（非 null 优先）→ 项目默认 → false。 */
export function resolveLowercaseLatin(
  segmentValue: boolean | null | undefined,
  projectValue: boolean | null | undefined,
): boolean {
  if (segmentValue !== null && segmentValue !== undefined) return Boolean(segmentValue);
  return Boolean(projectValue);
}

export interface ApplyTextTransformsOptions {
  mergedMap: PronunciationMapEntry[];
  applyAll?: boolean;
  appliedMapIds?: string[] | null;
  lowercaseLatin?: boolean;
}

/** 发音映射替换 → 大写词小写化（顺序固定，先于引擎文本清洗）。 */
export function applyTextTransforms(text: string, opts: ApplyTextTransformsOptions): string {
  if (!text) return text;
  const effective = opts.applyAll
    ? opts.mergedMap
    : opts.mergedMap.filter(e => (opts.appliedMapIds ?? []).includes(e.id));
  let out = applyPronunciationMap(text, effective);
  if (opts.lowercaseLatin) out = lowercaseLatinWords(out);
  return out;
}

/** 段级「送引擎文本」统一入口（映射面板预览 + frontend 存储模式合成共用）。 */
export function resolveSegmentEngineText(
  text: string,
  opts: {
    globalMap?: PronunciationMapEntry[] | null;
    projectMap?: PronunciationMapEntry[] | null;
    applyAll?: boolean | null;
    segmentTransforms?: SegmentTextTransforms | null;
    projectLowercaseLatin?: boolean | null;
  },
): string {
  return applyTextTransforms(text, {
    mergedMap: mergePronunciationMaps(opts.globalMap, opts.projectMap),
    applyAll: Boolean(opts.applyAll),
    appliedMapIds: opts.segmentTransforms?.applied_map_ids ?? null,
    lowercaseLatin: resolveLowercaseLatin(
      opts.segmentTransforms?.lowercase_latin ?? null,
      opts.projectLowercaseLatin ?? null,
    ),
  });
}
