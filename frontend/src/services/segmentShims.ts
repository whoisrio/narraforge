/**
 * segmentShims — Segment/Role type accessors
 */
import type { EngineParams, Segment } from '../types';

// ---- Segment params accessors ----

/** 从 Segment.voice 提取 params */
export function segParams(seg: Segment): Record<string, unknown> {
  if (seg.voice.source === 'custom') {
    // Partial<> 断言仅为规避 TS2783（params 必含 engine，显式 engine 会被覆盖），运行时行为不变
    return { engine: seg.voice.engine, ...(seg.voice.params as Partial<EngineParams>) };
  }
  if (seg.generated_params) {
    return seg.generated_params as Record<string, unknown>;
  }
  return { engine: 'edge_tts' };
}

/** 获取段落的 effective engine */
export function segEngine(seg: Segment): string {
  if (seg.voice.source === 'custom') return seg.voice.engine;
  if (seg.generated_params?.engine) return seg.generated_params.engine;
  return 'edge_tts';
}

/** 获取段落的 effective params */
export function segEffectiveParams(seg: Segment): Record<string, unknown> {
  if (seg.voice.source === 'custom') {
    // 同上：Partial<> 断言仅为规避 TS2783，运行时行为不变
    return { engine: seg.voice.engine, ...(seg.voice.params as Partial<EngineParams>) };
  }
  if (seg.generated_params) {
    return seg.generated_params as Record<string, unknown>;
  }
  return { engine: segEngine(seg) };
}

/** 检查段落的 voice 是否独立于全局 */
export function segHasOverride(seg: Segment): boolean {
  return seg.voice.source === 'custom';
}

/** 检查段落是否覆盖了特定字段 */
export function segFieldOverridden(seg: Segment, field: string): boolean {
  if (seg.voice.source !== 'custom') return false;
  if (field === 'voice') return true;
  return Object.prototype.hasOwnProperty.call(seg.voice.params, field);
}

/** 获取段落当前的覆盖字段列表 */
export function segOverrideFields(seg: Segment): string[] {
  if (seg.voice.source !== 'custom') return [];
  const fields: string[] = ['voice'];
  const params = seg.voice.params;
  if (params) {
    for (const k of Object.keys(params)) {
      if (k !== 'engine') fields.push(k);
    }
  }
  return fields;
}
