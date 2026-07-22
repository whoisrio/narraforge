import { useState, useEffect, useCallback, useRef } from 'react';
import type { Segment, EngineParams } from '../../types';
import { useTranslation } from '../../i18n';
import { segEngine, segEffectiveParams } from '../../services/segmentShims';
import styles from './SegmentEditDrawer.module.css';

interface SegmentEditDrawerProps {
  segment: Segment | null;
  onClose: () => void;
  onUpdateText: (id: string, text: string) => void;
  onUpdateSSML: (id: string, ssml: string) => void;
  onUpdateParams: (id: string, params: Partial<EngineParams>) => void;
  onRegenerate: (id: string) => void;
  onAnnotateSSML: (id: string) => void;
}

interface SegmentEditDrawerContentProps extends Omit<SegmentEditDrawerProps, 'segment'> {
  segment: Segment;
}

function SegmentEditDrawerContent({ segment, onClose, onUpdateText, onUpdateSSML, onUpdateParams, onRegenerate, onAnnotateSSML }: SegmentEditDrawerContentProps) {
  const { t } = useTranslation();
  const [localText, setLocalText] = useState(segment.text);
  const [localSSML, setLocalSSML] = useState('');
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isCosyVoice = segEngine(segment) === 'cosyvoice';
  const eff = segEffectiveParams(segment);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleClose = useCallback(() => {
    if (dirty) {
      const ok = confirm(t('segment.editDrawer.confirmDiscard'));
      if (!ok) return;
    }
    onClose();
  }, [dirty, onClose, t]);

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <span>{t('segment.editDrawer.title', { id: segment.id.slice(-3) })}</span>
          <button onClick={handleClose} className={styles.closeBtn}>✕</button>
        </div>

        <div className={styles.drawerBody}>
          <label className={styles.label}>{t('segment.editDrawer.text')}</label>
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
                <label className={styles.label}>{t('segment.editDrawer.ssml')}</label>
                <button className={styles.annotateBtn}
                  onClick={() => onAnnotateSSML(segment.id)}>
                  {t('segment.editDrawer.smartAnnotate')}
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
            <label className={styles.label}>{t('segment.editDrawer.speed')}</label>
            <input type="range" min={0.5} max={2} step={0.1}
              value={(eff.speed as number) ?? 1.0}
              onChange={(e) => onUpdateParams(segment.id, { speed: parseFloat(e.target.value) })} />

            <label className={styles.label}>{t('segment.editDrawer.pitch')}</label>
            <input type="range" min={0.5} max={2} step={0.1}
              value={(eff.pitch as number) ?? 1.0}
              onChange={(e) => onUpdateParams(segment.id, { pitch: parseFloat(e.target.value) })} />

            <label className={styles.label}>{t('segment.editDrawer.volume')}</label>
            <input type="range" min={0} max={100} step={1}
              value={(eff.volume as number) ?? 80}
              onChange={(e) => onUpdateParams(segment.id, { volume: parseInt(e.target.value) })} />
          </div>
        </div>

        <div className={styles.drawerFooter}>
          <div className={styles.footerRight}>
            <button className={styles.regenerateBtn}
              onClick={() => onRegenerate(segment.id)}>
              {t('segment.editDrawer.regenerate')}
            </button>
            <button className={styles.saveBtn} onClick={() => { setDirty(false); onClose(); }}>
              {t('segment.editDrawer.saveClose')}
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
