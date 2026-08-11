/**
 * TTS 引擎下拉（spec 第 4 节）：选项按部署能力 `engines` 过滤，
 * workers 模式只保留 edge_tts / mimo_tts。
 */
import { ALL_ENGINE_OPTIONS, type EngineId } from './engineOptions';

interface Props {
  value: EngineId;
  /** 当前部署可用的引擎 id 列表（来自 capabilities.engines） */
  availableEngines: string[];
  onChange: (engine: EngineId) => void;
  className?: string;
}

export function EngineSelect({ value, availableEngines, onChange, className }: Props) {
  return (
    <select
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value as EngineId)}
    >
      {ALL_ENGINE_OPTIONS.filter((option) => availableEngines.includes(option.id)).map((option) => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  );
}
