import type { ProsodyCapability, SegmentEngineParams } from '../types';

const CAPABILITIES: Record<SegmentEngineParams['engine'], ProsodyCapability> = {
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

export function getProsodyCapability(engine: SegmentEngineParams['engine']): ProsodyCapability {
  return CAPABILITIES[engine];
}
