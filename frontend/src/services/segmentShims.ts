/**
 * segmentShims — 兼容性桥接
 * 提供旧 Segment/Role 字段到新 V3 类型的访问器
 */
import type {
  Segment, EngineParams,
  EdgeTTSParams, CosyVoiceParams, MiMoParams, VoxCPMParams,
  VoiceProfile
} from '../types';

// ---- Segment params accessors ----

/** 从 Segment.voice 提取 params（用于生成显示） */
export function segParams(seg: Segment): Record<string, unknown> {
  if (seg.voice.source === 'custom') {
    return { engine: seg.voice.engine, ...seg.voice.params };
  }
  if (seg.generated_params) {
    return seg.generated_params as Record<string, unknown>;
  }
  return { engine: 'edge_tts' };
}

/** 获取段落的 effective engine（用于 UI 显示） */
export function segEngine(seg: Segment): string {
  if (seg.voice.source === 'custom') return seg.voice.engine;
  if (seg.generated_params?.engine) return seg.generated_params.engine;
  if (seg.voice.source === 'role') return 'edge_tts'; // role engine resolved elsewhere
  return 'edge_tts';
}

/** 获取段落的 effective flat params（用于 UI 显示） */
export function segEffectiveParams(seg: Segment): Record<string, unknown> {
  if (seg.voice.source === 'custom') {
    return { engine: seg.voice.engine, ...seg.voice.params };
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
  if (field === 'voice') return true; // custom voice always implies voice override
  return Object.prototype.hasOwnProperty.call(seg.voice.params, field);
}

/** 获取段落当前的覆盖字段列表（用于 UI） */
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

/** segment 上已生成的 voice_id */
export function segGeneratedVoiceId(seg: Segment): string | undefined {
  return (seg.generated_params as Record<string, unknown>)?.voice_id as string | undefined;
}

// ---- VoiceProfile accessors ----

export function vpQwenVoiceId(vp: VoiceProfile): string | undefined {
  return vp.engine?.qwen_voice_id;
}
export function vpIsCloned(vp: VoiceProfile): boolean {
  return vp.engine?.is_cloned ?? false;
}
export function vpCloneEngine(vp: VoiceProfile): string | undefined {
  return vp.engine?.type;
}
export function vpClonedAt(vp: VoiceProfile): string | undefined {
  return vp.engine?.cloned_at;
}
export function vpPromptText(vp: VoiceProfile): string | undefined {
  return vp.engine?.prompt_text;
}

// ---- Role accessors ----

/** Convert EngineParams to old SegmentEngineParams shape (for display) */
export function engineParamsToLegacy(v: EngineParams): Record<string, unknown> {
  if (v.engine === 'edge_tts') {
    const ev = v as EdgeTTSParams;
    return { engine: 'edge_tts', edge_voice: ev.voice, edge_rate: ev.rate, edge_volume: ev.volume };
  }
  if (v.engine === 'cosyvoice') {
    const cv = v as CosyVoiceParams;
    return { engine: 'cosyvoice', voice_id: cv.voice_id, instruction: cv.instruction, speed: cv.speed, volume: cv.volume, pitch: cv.pitch, language: cv.language, enable_ssml: cv.enable_ssml };
  }
  if (v.engine === 'mimo_tts') {
    const mv = v as MiMoParams;
    return { engine: 'mimo_tts', mimo_mode: mv.mode, mimo_preset_voice: mv.mode === 'preset' ? mv.voice_id : undefined, mimo_clone_voice_id: mv.mode !== 'preset' ? mv.voice_id : undefined, mimo_voice_description: mv.voice_description, mimo_instruction: mv.instruction };
  }
  // voxcpm
  const vv = v as VoxCPMParams;
  return { engine: 'voxcpm', voice_id: vv.voice_id, voxcpm_mode: vv.mode, voxcpm_voice_description: vv.voice_description, voxcpm_style_control: vv.style_control, voxcpm_prompt_text: vv.prompt_text, voxcpm_cfg_value: vv.cfg_value, voxcpm_inference_timesteps: vv.inference_timesteps };
}
