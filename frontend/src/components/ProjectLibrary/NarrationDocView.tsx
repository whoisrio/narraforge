import { useState } from 'react';
import Markdown from 'react-markdown';
import { useTranslation } from '../../i18n';
import { countTextChars, estimateDurationSec, formatSeconds } from './utils';
import styles from './NarrationDocView.module.css';

interface NarrationDocViewProps {
  /** 项目级旁白文档源稿（narration_script）。空 -> 形态 A（章节优先回退）。 */
  narrationScript: string | null;
  /** 现有章节合并文本，用于形态 A 回退预览 + 「从现有章节生成」。 */
  joinedChapterText: string;
  chapterCount: number;
  onUpdateNarrationScript: (text: string) => void;
  onSplit: () => void;
  onBack: () => void;
  onViewByChapter: () => void;
}

/**
 * 旁白文档视图（全文视图的替代）。
 *
 * 形态 A（narration_script 为空）：章节合并只读预览 + 转换入口
 *   （粘贴旁白文档 / 从现有章节生成），不显示拆分按钮。
 * 形态 B（narration_script 已存在）：编辑/预览切换 + 顶栏「按标题拆分章节」。
 */
export function NarrationDocView({
  narrationScript,
  joinedChapterText,
  chapterCount,
  onUpdateNarrationScript,
  onSplit,
  onBack,
  onViewByChapter,
}: NarrationDocViewProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'view' | 'edit'>('view');

  const narrationText = narrationScript ?? '';
  const hasNarration = narrationText.trim().length > 0;
  const previewText = hasNarration ? narrationText : joinedChapterText;
  const chars = countTextChars(previewText);
  const duration = estimateDurationSec(previewText);
  const showToggle = hasNarration || viewMode === 'edit';
  const canGenerateFromChapters = joinedChapterText.trim().length > 0;

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('projectLibrary.narrationDoc.title')}</h2>
        <div className={styles.metrics}>
          <span>{chars} {t('projectLibrary.wordCount')}</span>
          <span>{t('projectLibrary.estimated')} {formatSeconds(duration)}</span>
          <span>{chapterCount} {t('projectLibrary.chapterCount')}</span>
        </div>
        <div className={styles.actions}>
          {hasNarration && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={onSplit}
              title={t('projectLibrary.splitChapters')}
            >
              {t('projectLibrary.splitChapters')}
            </button>
          )}
          {showToggle && (
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => setViewMode(viewMode === 'view' ? 'edit' : 'view')}
            >
              {viewMode === 'view' ? t('common.edit') : t('projectLibrary.view')}
            </button>
          )}
        </div>
      </header>

      <div className={styles.body}>
        {viewMode === 'edit' ? (
          <textarea
            className={styles.editor}
            value={narrationText}
            onChange={(e) => onUpdateNarrationScript(e.target.value)}
            placeholder={t('projectLibrary.narrationDoc.editorPlaceholder')}
            aria-label={t('projectLibrary.narrationDoc.title')}
          />
        ) : hasNarration ? (
          <div className={styles.preview}>
            <Markdown>{narrationText || `*${t('projectLibrary.noContent')}*`}</Markdown>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <p className={styles.emptyHint}>{t('projectLibrary.narrationDoc.emptyHint')}</p>
            <div className={styles.emptyActions}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setViewMode('edit')}
              >
                {t('projectLibrary.narrationDoc.paste')}
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => onUpdateNarrationScript(joinedChapterText)}
                disabled={!canGenerateFromChapters}
              >
                {t('projectLibrary.narrationDoc.generateFromChapters')}
              </button>
            </div>
            <p className={styles.fallbackLabel}>{t('projectLibrary.narrationDoc.fallbackPreviewLabel')}</p>
            <div className={styles.preview}>
              <Markdown>{joinedChapterText || `*${t('projectLibrary.noContent')}*`}</Markdown>
            </div>
          </div>
        )}
      </div>

      <div className={styles.bottomBar}>
        <button type="button" className={styles.ghostBtn} onClick={onBack}>
          ← {t('projectLibrary.backToLibrary')}
        </button>
        <div className={styles.bottomBarDivider} />
        <button type="button" className={styles.ghostBtn} onClick={onViewByChapter}>
          {t('projectLibrary.viewByChapter')}
        </button>
      </div>
    </section>
  );
}
