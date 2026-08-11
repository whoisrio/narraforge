/** TTS 引擎选项清单（react-refresh 要求与组件文件分离）。本地全量顺序即历史 UI 顺序。 */

export type EngineId = 'cosyvoice' | 'edge_tts' | 'mimo_tts' | 'voxcpm';

export const ALL_ENGINE_OPTIONS: Array<{ id: EngineId; label: string }> = [
  { id: 'edge_tts', label: 'Edge-TTS' },
  { id: 'cosyvoice', label: 'CosyVoice' },
  { id: 'mimo_tts', label: 'MiMo TTS' },
  { id: 'voxcpm', label: 'VoxCPM' },
];
