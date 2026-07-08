import { useState } from 'react';
import { useTranslation } from '../../i18n';
import type { SourceDocument } from '../../types';
import styles from './GenerateNarrationModal.module.css';

interface GenerateNarrationModalProps {
  sources: SourceDocument[];
  onClose: () => void;
  onGenerate: (selectedSourceIds: string[], promptHint: string) => void;
}

export function GenerateNarrationModal({ sources, onClose, onGenerate }: GenerateNarrationModalProps) {
  const { t } = useTranslation();
  // 默认全选
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(sources.map(s => s.id))
  );
  const [promptHint, setPromptHint] = useState('');
  const [targetChapters, setTargetChapters] = useState(3);
  const [targetWords, setTargetWords] = useState(t('generateNarration.defaultWordCount'));
  const [engine, setEngine] = useState('mimo');

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    if (selectedIds.size === 0) return;
    onGenerate(Array.from(selectedIds), promptHint);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{t('generateNarration.title')}</h2>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <p className={styles.desc}>
          {t('generateNarration.description')}
        </p>

        <div className={styles.section}>
          <label className={styles.label}>{t('generateNarration.selectedSources', { selected: selectedIds.size, total: sources.length })}</label>
          <div className={styles.sourceList}>
            {sources.map(src => {
              const selected = selectedIds.has(src.id);
              return (
                <button
                  key={src.id}
                  className={`${styles.sourceChip} ${selected ? styles.sourceChipSelected : ''}`}
                  onClick={() => toggleId(src.id)}
                  type="button"
                >
                  <span className={styles.chk}>{selected ? '✓' : '·'}</span>
                  <span className={styles.chipIcon}>
                    {src.source_type === 'paste' ? '📄' : src.source_type === 'audio' ? '🎵' : '🔗'}
                  </span>
                  <span className={styles.chipTitle}>{src.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>{t('generateNarration.promptHint')}</label>
          <textarea
            className={styles.textarea}
            placeholder={t('generateNarration.promptPlaceholder')}
            value={promptHint}
            onChange={e => setPromptHint(e.target.value)}
            rows={3}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>{t('generateNarration.targetChapters')}</label>
            <input
              type="number"
              min={1}
              max={10}
              value={targetChapters}
              onChange={e => setTargetChapters(parseInt(e.target.value, 10) || 1)}
              className={styles.input}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('generateNarration.wordCount')}</label>
            <input
              type="text"
              value={targetWords}
              onChange={e => setTargetWords(e.target.value)}
              className={styles.input}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('generateNarration.engine')}</label>
            <select
              value={engine}
              onChange={e => setEngine(e.target.value)}
              className={styles.input}
            >
              <option value="mimo">{t('generateNarration.engineMiMo')}</option>
              <option value="qwen">Qwen</option>
              <option value="rule">{t('generateNarration.engineRule')}</option>
            </select>
          </div>
        </div>

        <div className={styles.note}>
          {t('generateNarration.generationNote')}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>{t('generateNarration.cancel')}</button>
          <button
            className={styles.primaryBtn}
            onClick={handleSubmit}
            disabled={selectedIds.size === 0}
          >
            {t('generateNarration.generateNewVersion')}
          </button>
        </div>
      </div>
    </div>
  );
}
