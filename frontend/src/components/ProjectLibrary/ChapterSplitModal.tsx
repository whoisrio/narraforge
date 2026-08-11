import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import {
  segmentedProjectApi,
  textSplitApi,
  type MarkdownChapterItem,
  type MarkdownDetectResponse,
  type MarkdownSplitResponse,
} from '../../services/api';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/useToast';
import styles from './ChapterSplitModal.module.css';

interface ChapterSplitModalProps {
  projectId: string;
  /** 完整旁白文档（按标题拆分的源文本） */
  fullText: string;
  existingChapterCount: number;
  onClose: () => void;
  onApplied: () => void;
}

type Phase = 'detecting' | 'configure' | 'error';

/** 剩掉切片里的 markdown 标题行，得到章节正文。与 agent parse_markdown_chapters
 * 语义一致（L2 narration_script 不含标题），studio 拆分段落时也不会把标题当正文。 */
function chapterBody(slice: string): string {
  return slice
    .split('\n')
    .filter((line) => !/^#{1,6}\s/.test(line.trimStart()))
    .join('\n')
    .trim();
}

/** 拆分出的章节默认带零填充序号前缀（01. 02. …），与章节卡片的 CH 徽章一致。 */
function numberedTitle(index: number, title: string): string {
  return `${String(index + 1).padStart(2, '0')}. ${title}`;
}

/**
 * 从完整旁白文档按 markdown 标题拆分章节：
 * detect 探测层级 → 用户选 levels → split 预览 → chapters:batch 应用（替换现有章节）。
 */
export function ChapterSplitModal({ projectId, fullText, existingChapterCount, onClose, onApplied }: ChapterSplitModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('detecting');
  const [error, setError] = useState<string | null>(null);
  const [detect, setDetect] = useState<MarkdownDetectResponse | null>(null);
  const [levels, setLevels] = useState<number[]>([2]);
  const [preview, setPreview] = useState<MarkdownSplitResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [splitSegments, setSplitSegments] = useState(false);

  useEffect(() => {
    let alive = true;
    textSplitApi.markdownDetect(fullText)
      .then((d) => {
        if (!alive) return;
        setDetect(d);
        // 默认选中候选最多的层级（通常是 H2）
        const counts = new Map<number, number>();
        for (const c of d.candidates) counts.set(c.level, (counts.get(c.level) ?? 0) + 1);
        if (counts.size > 0) {
          const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
          setLevels([best]);
        }
        setPhase('configure');
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      });
    return () => { alive = false; };
  }, [fullText]);

  const levelCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const c of detect?.candidates ?? []) counts.set(c.level, (counts.get(c.level) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [detect]);

  const toggleLevel = (level: number) => {
    setLevels((prev) => {
      const next = prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level];
      return next.sort((a, b) => a - b);
    });
    setPreview(null);
  };

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await textSplitApi.markdownSplit(fullText, levels));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const chapters = preview.chapters.map((ch: MarkdownChapterItem, idx: number) => {
        const body = chapterBody(fullText.slice(ch.start_char, ch.end_char));
        return {
          chapter_title: numberedTitle(idx, ch.title),
          narration_script: body,
          original_text: body,
        };
      });
      // 重拆（已有章节）时保留文本未变 segment 的已合成音频
      const result = await segmentedProjectApi.batchCreateChapters(projectId, chapters, fullText, {
        preserveAudio: existingChapterCount > 0,
        splitSegments,
      });
      if (result.reuse) {
        toast.success(t('chapterSplit.reuseReport', {
          reused: result.reuse.segments_reused,
          fresh: result.reuse.segments_new,
        }));
      }
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-label={t('chapterSplit.title')}>
      <section className={styles.card}>
        <header className={styles.header}>
          <h3>{t('chapterSplit.title')}</h3>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>×</button>
        </header>
        <div className={styles.body}>
          {phase === 'detecting' && <p>{t('chapterSplit.detecting')}</p>}
          {error && <p className={styles.error}>{error}</p>}
          {phase === 'configure' && detect && (
            <>
              {detect.doc_title && <p className={styles.docTitle}>{detect.doc_title}</p>}
              <fieldset className={styles.levels}>
                <legend>{t('chapterSplit.levels')}</legend>
                {levelCounts.map(([level, count]) => (
                  <label key={level} className={styles.levelItem}>
                    <input
                      type="checkbox"
                      checked={levels.includes(level)}
                      onChange={() => toggleLevel(level)}
                    />
                    H{level} ({count})
                  </label>
                ))}
                <p className={styles.levelsHint}>{t('chapterSplit.levelsHint')}</p>
              </fieldset>
              <fieldset className={styles.levels}>
                <legend>{t('chapterSplit.options')}</legend>
                <label className={styles.levelItem}>
                  <input
                    type="checkbox"
                    checked={splitSegments}
                    onChange={() => setSplitSegments((v) => !v)}
                  />
                  {t('chapterSplit.splitSegments')}
                </label>
                <p className={styles.levelsHint}>{t('chapterSplit.splitSegmentsHint')}</p>
              </fieldset>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => void runPreview()}
                disabled={busy || levels.length === 0}
              >
                {t('chapterSplit.preview')}
              </button>
              {preview && (
                <div className={styles.previewList}>
                  <p className={styles.previewMeta}>
                    {t('chapterSplit.previewMeta', { count: preview.chapters.length, chars: preview.total_chars })}
                  </p>
                  <ol>
                    {preview.chapters.map((ch, idx) => (
                      <li key={ch.index}>
                        <strong>{numberedTitle(idx, ch.title)}</strong>
                        <span className={styles.chapterMeta}>H{ch.level} · {ch.char_count} {t('chapterSplit.chars')}</span>
                        {ch.preview && <p className={styles.previewText}>{ch.preview}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {preview && existingChapterCount > 0 && (
                <p className={styles.warning}>
                  {t('chapterSplit.replaceWarning', { count: existingChapterCount })}
                  {' '}{t('chapterSplit.preserveHint')}
                </p>
              )}
            </>
          )}
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>{t('common.cancel')}</button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => (existingChapterCount > 0 ? setConfirmReplace(true) : void apply())}
            disabled={busy || !preview || preview.chapters.length === 0}
          >
            {busy ? t('chapterSplit.applying') : t('chapterSplit.apply')}
          </button>
        </footer>
      </section>
      <ConfirmDialog
        open={confirmReplace}
        title={t('chapterSplit.confirmTitle')}
        message={t('chapterSplit.confirmMessage', { count: existingChapterCount })}
        confirmLabel={t('chapterSplit.confirmLabel')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={() => { setConfirmReplace(false); void apply(); }}
        onCancel={() => setConfirmReplace(false)}
      />
    </div>
  );
}
