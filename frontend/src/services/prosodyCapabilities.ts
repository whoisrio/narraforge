import type { ProsodyCapability, EngineParams } from '../types';

const CAPABILITIES: Record<EngineParams['engine'], ProsodyCapability> = {
  edge_tts: {
    supportsEmotion: false,
    supportsStyleTags: true,
    supportsInstruction: false,
    supportsSsml: false,
    requiresSplitFallback: true,
  },
  cosyvoice: {
    supportsEmotion: true,
    supportsStyleTags: true,
    supportsInstruction: true,
    supportsSsml: true,
    requiresSplitFallback: false,
  },
  mimo_tts: {
    supportsEmotion: true,
    supportsStyleTags: true,
    supportsInstruction: true,
    supportsSsml: false,
    requiresSplitFallback: false,
  },
  voxcpm: {
    supportsEmotion: true,
    supportsStyleTags: true,
    supportsInstruction: true,
    supportsSsml: false,
    requiresSplitFallback: false,
  },
};

export function getProsodyCapability(engine: EngineParams['engine']): ProsodyCapability {
  return CAPABILITIES[engine];
}
