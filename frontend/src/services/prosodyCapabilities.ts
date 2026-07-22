import type { ProsodyCapability, EngineParams } from '../types';
import { ENGINE_CAPABILITIES } from './styleTags';

// 值由 styleTags.ts 的 ENGINE_CAPABILITIES 派生（与后端 engine_capabilities.py 镜像），
// 避免两套矩阵漂移。supportsSsml / requiresSplitFallback 是 styleTags 之外的既有语义，保持原值。
const SSML_SUPPORT: Record<EngineParams['engine'], boolean> = {
  edge_tts: false,
  cosyvoice: true,
  mimo_tts: false,
  voxcpm: false,
};

const CAPABILITIES: Record<EngineParams['engine'], ProsodyCapability> = Object.fromEntries(
  (Object.keys(ENGINE_CAPABILITIES) as EngineParams['engine'][]).map((engine) => {
    const cap = ENGINE_CAPABILITIES[engine];
    return [
      engine,
      {
        supportsEmotion: cap.leading,
        supportsStyleTags: cap.inline || cap.leading,
        supportsInstruction: cap.instruction,
        supportsSsml: SSML_SUPPORT[engine],
        requiresSplitFallback: engine === 'edge_tts',
      } satisfies ProsodyCapability,
    ];
  }),
) as Record<EngineParams['engine'], ProsodyCapability>;

export function getProsodyCapability(engine: EngineParams['engine']): ProsodyCapability {
  return CAPABILITIES[engine];
}
