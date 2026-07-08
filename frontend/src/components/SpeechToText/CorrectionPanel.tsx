import { useState } from 'react';
import type { CorrectionSuggestion } from '../../services/api';
import { computeCharDiff } from '../../hooks/useTranscription';
import { Button } from '../ui/Button';
import { useTranslation } from '../../i18n';
import styles from './CorrectionPanel.module.css';

interface CorrectionPanelProps {
  suggestions: CorrectionSuggestion[];
  acceptedSuggestions: Set<number>;
  correctionModel: string | null;
  correcting: boolean;
  originalDoc: string;
  correctionMode: 'smart' | 'full';
  onOriginalDocChange: (doc: string) => void;
  onModeChange: (mode: 'smart' | 'full') => void;
  onCorrect: () => void;
  onToggleAccept: (index: number) => void;
  onApply: () => void;
}

export function CorrectionPanel({
  suggestions,
  acceptedSuggestions,
  correctionModel,
  correcting,
  originalDoc,
  correctionMode,
  onOriginalDocChange,
  onModeChange,
  onCorrect,
  onToggleAccept,
  onApply,
}: CorrectionPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.container}>
      <button className={styles.toggle} onClick={() => setExpanded(!expanded)}>
        <div className={styles.toggleLeft}>
          <span className="material-symbols-outlined">spellcheck</span>
          <span className={styles.toggleTitle}>{t('correctionPanel.title')}</span>
          {suggestions.length > 0 && (
            <span className={styles.countBadge}>{suggestions.length}</span>
          )}
          {correctionModel && <span className={styles.modelTag}>{correctionModel}</span>}
        </div>
        <span className={`material-symbols-outlined ${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}>
          expand_more
        </span>
      </button>

      {expanded && (
        <div className={styles.content}>
          <p className={styles.description}>{t('correctionPanel.description')}</p>

          <div className={styles.modeRow}>
            <button
              className={`${styles.modeBtn} ${correctionMode === 'smart' ? styles.modeBtnActive : ''}`}
              onClick={() => onModeChange('smart')}
            >
              <span className="material-symbols-outlined">bolt</span>
              {t('correctionPanel.smartMode')}
              <span className={styles.modeHint}>{t('correctionPanel.smartModeHint')}</span>
            </button>
            <button
              className={`${styles.modeBtn} ${correctionMode === 'full' ? styles.modeBtnActive : ''}`}
              onClick={() => onModeChange('full')}
            >
              <span className="material-symbols-outlined">search</span>
              {t('correctionPanel.fullMode')}
              <span className={styles.modeHint}>{t('correctionPanel.fullModeHint')}</span>
            </button>
          </div>

          <textarea
            className={styles.docInput}
            placeholder={t('correctionPanel.placeholder')}
            value={originalDoc}
            onChange={(e) => onOriginalDocChange(e.target.value)}
            rows={4}
          />

          <div className={styles.actions}>
            <Button
              variant="primary"
              loading={correcting}
              disabled={correcting || !originalDoc.trim()}
              onClick={onCorrect}
            >
              {correcting ? t('correctionPanel.correcting') : t('correctionPanel.startCorrection')}
            </Button>
            {suggestions.length > 0 && (
              <span className={styles.resultHint}>{t('correctionPanel.foundErrors', { count: suggestions.length })}</span>
            )}
            {suggestions.length === 0 && correctionModel && !correcting && (
              <span className={styles.okHint}>{t('correctionPanel.noErrors')}</span>
            )}
          </div>

          {suggestions.length > 0 && (
            <>
              <div className={styles.tableToolbar}>
                <div className={styles.tableToolbarLeft}>
                  <span className={styles.countBadge}>{suggestions.length}</span>
                  <span>{t('correctionPanel.errorCount')}</span>
                </div>
                <div className={styles.tableToolbarRight}>
                  <button className={styles.linkBtn} onClick={() => {
                    if (acceptedSuggestions.size === suggestions.length) {
                      // deselect all — handled by parent resetting
                    }
                  }}>
                    {acceptedSuggestions.size === suggestions.length ? t('correctionPanel.deselectAll') : t('correctionPanel.selectAll')}
                  </button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={acceptedSuggestions.size === 0}
                    onClick={onApply}
                  >
                    {t('correctionPanel.applyChanges')} {acceptedSuggestions.size > 0 && `(${acceptedSuggestions.size})`}
                  </Button>
                </div>
              </div>

              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.colCheck}></div>
                  <div className={styles.colIdx}>#</div>
                  <div className={styles.colLeft}>{t('correctionPanel.recognizedText')}</div>
                  <div className={styles.colRight}>{t('correctionPanel.correctedText')}</div>
                  <div className={styles.colReason}>{t('correctionPanel.explanation')}</div>
                </div>
                {suggestions.map((s, i) => {
                  const accepted = acceptedSuggestions.has(s.index);
                  const diff = computeCharDiff(s.original, s.suggested);
                  return (
                    <div
                      key={`${s.index}-${i}`}
                      className={`${styles.row} ${accepted ? styles.rowActive : ''}`}
                      onClick={() => onToggleAccept(s.index)}
                    >
                      <div className={styles.colCheck}>
                        <div className={`${styles.check} ${accepted ? styles.checkOn : ''}`}>
                          {accepted && '✓'}
                        </div>
                      </div>
                      <div className={styles.colIdx}>{s.index}</div>
                      <div className={styles.colLeft}>
                        {diff.left.map((part, j) =>
                          part.changed
                            ? <del key={j} className={styles.del}>{part.text}</del>
                            : <span key={j}>{part.text}</span>
                        )}
                      </div>
                      <div className={styles.colRight}>
                        {diff.right.map((part, j) =>
                          part.changed
                            ? <ins key={j} className={styles.ins}>{part.text}</ins>
                            : <span key={j}>{part.text}</span>
                        )}
                      </div>
                      <div className={styles.colReason}>
                        <span className={`${styles.conf} ${
                          s.confidence === 'high' ? styles.confHigh :
                          s.confidence === 'medium' ? styles.confMed : styles.confLow
                        }`}>{s.confidence === 'high' ? t('correctionPanel.confidenceHigh') : s.confidence === 'medium' ? t('correctionPanel.confidenceMedium') : t('correctionPanel.confidenceLow')}</span>
                        {s.reason}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
