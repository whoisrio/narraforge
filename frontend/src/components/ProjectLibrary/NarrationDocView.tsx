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
  /** 形态 A 次按钮：切到源文档视图（B2）。 */
  onGoToSource: () => void;
}

/**
 * 旁白文档视图（Library 默认 landing 视图，B2）。
 *
 * 形态 A（narration_script 为空）：粘贴 CTA 主按钮 + 「去源文档」次按钮
 *   + 有章节文本时保留「从现有章节生成」回退，不显示拆分按钮。
 * 形态 B（narration_script 已存在）：编辑/预览切换 + 顶栏「按标题拆分章节」。
 * 底部「返回资料库 / 按章节查看」条已移除——头部视图切换器覆盖导航。
 */
export function NarrationDocView({
  narrationScript,
  joinedChapterText,
  chapterCount,
  onUpdateNarrationScript,
  onSplit,
  onGoToSource,
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
                onClick={onGoToSource}
              >
                {t('projectLibrary.narrationDoc.goToSource')}
              </button>
              {canGenerateFromChapters && (
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => onUpdateNarrationScript(joinedChapterText)}
                >
                  {t('projectLibrary.narrationDoc.generateFromChapters')}
                </button>
              )}
            </div>
            <p className={styles.fallbackLabel}>{t('projectLibrary.narrationDoc.fallbackPreviewLabel')}</p>
            <div className={styles.preview}>
              <Markdown>{joinedChapterText || `*${t('projectLibrary.noContent')}*`}</Markdown>
            </div>
          </div>
        )}
      </div>

    </section>
  );
}
