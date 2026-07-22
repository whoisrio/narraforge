import { useEffect, useRef, useState } from 'react';
import type { SelectEngineInterrupt } from '../../services/langgraph/types';
import { describeEngineCapability } from '../../services/styleTags';
import styles from './EngineSelectPanel.module.css';

interface Props {
  interrupt: SelectEngineInterrupt;
  onRespond: (payload: { engine: string }) => void;
}

const ENGINE_LABELS: Record<string, string> = {
  edge_tts: 'Edge-TTS',
  cosyvoice: 'CosyVoice',
  mimo_tts: 'MiMo TTS',
  voxcpm: 'VoxCPM',
};

/**
 * 引擎询问 interrupt 面板：default_engine 预选中，timeout_s 倒计时结束
 * 自动提交默认引擎；用户手动选择后停止倒计时，确认按钮提交所选。
 */
export function EngineSelectPanel({ interrupt, onRespond }: Props) {
  const { available_engines, default_engine, timeout_s } = interrupt;
  const [selected, setSelected] = useState(default_engine);
  const [remaining, setRemaining] = useState(timeout_s);
  // 用户手动选择后锁定（停止倒计时）
  const [locked, setLocked] = useState(false);
  // 防止倒计时与确认按钮重复提交
  const respondedRef = useRef(false);
  // 截止时间戳：remaining 由 Date.now() 差值推导，tick 丢失/合批也不影响准确性。
  // Date.now() 不纯，只能在 effect 里初始化（React Compiler 约束）。
  const deadlineRef = useRef(0);

  useEffect(() => {
    if (locked || respondedRef.current) return;
    if (!deadlineRef.current) deadlineRef.current = Date.now() + timeout_s * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && !respondedRef.current) {
        respondedRef.current = true;
        onRespond({ engine: default_engine });
      }
    };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [locked, default_engine, timeout_s, onRespond]);

  const handleSelect = (engine: string) => {
    setSelected(engine);
    setLocked(true);
  };

  const handleConfirm = () => {
    if (respondedRef.current) return;
    respondedRef.current = true;
    onRespond({ engine: selected });
  };

  const pct = timeout_s > 0 ? Math.max(0, (remaining / timeout_s) * 100) : 0;

  return (
    <div className={styles.panel}>
      <div className={styles.titleRow}>
        <span className="material-symbols-outlined">graphic_eq</span>
        <strong>选择 TTS 引擎</strong>
      </div>

      <div className={styles.countdownTrack}>
        <div className={styles.countdownBar} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.countdownText}>
        {locked
          ? '已手动选择，倒计时停止'
          : `${remaining}s 后自动使用默认引擎 ${ENGINE_LABELS[default_engine] ?? default_engine}`}
      </div>

      <div className={styles.engineList}>
        {available_engines.map((engine) => (
          <button
            key={engine}
            type="button"
            className={`${styles.engineCard} ${selected === engine ? styles.engineCardActive : ''}`}
            onClick={() => handleSelect(engine)}
          >
            <span className={styles.engineName}>
              {ENGINE_LABELS[engine] ?? engine}
              {engine === default_engine && <span className={styles.defaultBadge}>默认</span>}
            </span>
            <span className={styles.engineCap}>{describeEngineCapability(engine)}</span>
          </button>
        ))}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.confirmBtn} onClick={handleConfirm}>
          确认（{ENGINE_LABELS[selected] ?? selected}）
        </button>
      </div>
    </div>
  );
}
