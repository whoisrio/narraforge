import { useState, useEffect, useCallback, useRef } from 'react';
import type { Segment, SegmentEngineParams } from '../../types';
import styles from './SegmentEditDrawer.module.css';

interface SegmentEditDrawerProps {
  segment: Segment | null;
  onClose: () => void;
  onUpdateText: (id: string, text: string) => void;
  onUpdateSSML: (id: string, ssml: string) => void;
  onUpdateParams: (id: string, params: Partial<SegmentEngineParams>) => void;
  onRegenerate: (id: string) => void;
  onAnnotateSSML: (id: string) => void;
}

interface SegmentEditDrawerContentProps extends Omit<SegmentEditDrawerProps, 'segment'> {
  segment: Segment;
}

function SegmentEditDrawerContent({ segment, onClose, onUpdateText, onUpdateSSML, onUpdateParams, onRegenerate, onAnnotateSSML }: SegmentEditDrawerContentProps) {
  const [localText, setLocalText] = useState(segment.text);
  const [localSSML, setLocalSSML] = useState(segment.ssml ?? '');
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isCosyVoice = segment.params.engine === 'cosyvoice';

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleClose = useCallback(() => {
    if (dirty) {
      const ok = confirm('未保存修改将丢失，确认放弃？');
      if (!ok) return;
    }
    onClose();
  }, [dirty, onClose]);

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <span>编辑 #{segment.id.slice(-3)}</span>
          <button onClick={handleClose} className={styles.closeBtn}>✕</button>
        </div>

        <div className={styles.drawerBody}>
          <label className={styles.label}>文本</label>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={localText}
            onChange={(e) => { setLocalText(e.target.value); setDirty(true); onUpdateText(segment.id, e.target.value); }}
            rows={3}
          />

          {isCosyVoice && (
            <>
              <div className={styles.ssmlHeader}>
                <label className={styles.label}>SSML 标记</label>
                <button className={styles.annotateBtn}
                  onClick={() => onAnnotateSSML(segment.id)}>
                  ✨ 智能标注
                </button>
              </div>
              <textarea
                className={styles.textarea}
                value={localSSML}
                placeholder="<speak>...</speak>"
                onChange={(e) => { setLocalSSML(e.target.value); setDirty(true); onUpdateSSML(segment.id, e.target.value); }}
                rows={3}
              />
            </>
          )}

          <div className={styles.paramGrid}>
            <label className={styles.label}>语速</label>
            <input type="range" min={0.5} max={2} step={0.1}
              value={segment.params.speed ?? 1.0}
              onChange={(e) => onUpdateParams(segment.id, { speed: parseFloat(e.target.value) })} />

            <label className={styles.label}>音调</label>
            <input type="range" min={0.5} max={2} step={0.1}
              value={segment.params.pitch ?? 1.0}
              onChange={(e) => onUpdateParams(segment.id, { pitch: parseFloat(e.target.value) })} />

            <label className={styles.label}>音量</label>
            <input type="range" min={0} max={100} step={1}
              value={segment.params.volume ?? 80}
              onChange={(e) => onUpdateParams(segment.id, { volume: parseInt(e.target.value) })} />
          </div>
        </div>

        <div className={styles.drawerFooter}>
          <div className={styles.footerRight}>
            <button className={styles.regenerateBtn}
              onClick={() => onRegenerate(segment.id)}>
              ↻ 重新生成
            </button>
            <button className={styles.saveBtn} onClick={() => { setDirty(false); onClose(); }}>
              ✓ 保存关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SegmentEditDrawer({ segment, ...props }: SegmentEditDrawerProps) {
  if (!segment) return null;
  return <SegmentEditDrawerContent key={segment.id} segment={segment} {...props} />;
}
