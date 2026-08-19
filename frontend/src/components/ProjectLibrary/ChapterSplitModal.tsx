import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import {
  segmentedProjectApi,
  textSplitApi,
  type BatchReuseReport,
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
  /** A6：旁白文档与当前章节内容存在分叉（章节侧有编辑）——应用后以文档为准 */
  divergenceWarning?: boolean;
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
export function ChapterSplitModal({ projectId, fullText, existingChapterCount, divergenceWarning, onClose, onApplied }: ChapterSplitModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('detecting');
  const [error, setError] = useState<string | null>(null);
  const [detect, setDetect] = useState<MarkdownDetectResponse | null>(null);
  const [levels, setLevels] = useState<number[]>([2]);
  const [preview, setPreview] = useState<MarkdownSplitResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  // A3：首拆默认勾选（拆完即可进 Studio 合成）；重拆隐藏勾选框、恒拆分
  const [splitSegments, setSplitSegments] = useState(true);
  const [dryRunReport, setDryRunReport] = useState<BatchReuseReport | null>(null);
  const isResplit = existingChapterCount > 0;
  // 重拆：保留音频在语义上蕴含重建 segment，恒发 split_segments=true
  const effectiveSplitSegments = isResplit ? true : splitSegments;

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

  const buildChaptersPayload = (split: MarkdownSplitResponse) =>
    split.chapters.map((ch: MarkdownChapterItem, idx: number) => {
      const body = chapterBody(fullText.slice(ch.start_char, ch.end_char));
      return {
        chapter_title: numberedTitle(idx, ch.title),
        narration_script: body,
        original_text: body,
      };
    });

  // A4：重拆时预览出来后后台 dry_run，确认框如实展示保留/丢弃明细；
  // dry_run 失败退回现文案，不阻塞拆分。
  useEffect(() => {
    if (!preview || !isResplit) {
      setDryRunReport(null);
      return;
    }
    let alive = true;
    segmentedProjectApi.batchCreateChapters(projectId, buildChaptersPayload(preview), fullText, {
      preserveAudio: true,
      splitSegments: true,
      dryRun: true,
    })
      .then((r) => { if (alive) setDryRunReport(r.reuse ?? null); })
      .catch(() => { if (alive) setDryRunReport(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, isResplit, projectId, fullText]);

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const chapters = buildChaptersPayload(preview);
      // 重拆（已有章节）时保留文本未变 segment 的已合成音频
      const result = await segmentedProjectApi.batchCreateChapters(projectId, chapters, fullText, {
        preserveAudio: isResplit,
        splitSegments: effectiveSplitSegments,
      });
      if (result.reuse) {
        // A4：toast 与确认框同口径——保留/丢弃明细 + 录音警示
        let msg = t('chapterSplit.reuseReport', {
          reused: result.reuse.segments_reused,
          fresh: result.reuse.segments_new,
        });
        const discard = result.reuse.discard;
        const discardTotal = (discard?.text_changed ?? 0) + (discard?.boundary_changed ?? 0);
        if (discardTotal > 0) {
          msg += t('chapterSplit.reuseReportDiscard', {
            total: discardTotal,
            textChanged: discard?.text_changed ?? 0,
            boundaryChanged: discard?.boundary_changed ?? 0,
          });
        }
        if ((result.reuse.recorded_discard ?? 0) > 0) {
          msg += t('chapterSplit.reuseReportRecorded', { count: result.reuse.recorded_discard });
        }
        toast.success(msg);
      }
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // A4 诚实确认：有 dry_run 报告时展示预计保留/丢弃明细；否则退回现文案
  const discardTotal = (dryRunReport?.discard?.text_changed ?? 0) + (dryRunReport?.discard?.boundary_changed ?? 0);
  const confirmMessage = dryRunReport && preview ? (
    <>
      <p>{t('chapterSplit.confirmChapters', { count: preview.chapters.length })}</p>
      <p>{t('chapterSplit.confirmKept', { count: dryRunReport.segments_reused })}</p>
      {discardTotal > 0 && (
        <p>{t('chapterSplit.confirmDiscard', {
          total: discardTotal,
          textChanged: dryRunReport.discard?.text_changed ?? 0,
          boundaryChanged: dryRunReport.discard?.boundary_changed ?? 0,
        })}</p>
      )}
      {(dryRunReport.recorded_discard ?? 0) > 0 && (
        <p className={styles.recordedWarning}>
          {t('chapterSplit.confirmRecorded', { count: dryRunReport.recorded_discard })}
        </p>
      )}
    </>
  ) : t('chapterSplit.confirmMessage', { count: existingChapterCount });

  return (
    <div className={styles.overlay} role="dialog" aria-label={t('chapterSplit.title')}>
      <section className={styles.card}>
        <header className={styles.header}>
          <h3>{t('chapterSplit.title')}</h3>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>×</button>
        </header>
        <div className={styles.body}>
          {divergenceWarning && (
            <p className={styles.warning}>{t('chapterSplit.divergenceWarning')}</p>
          )}
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
              {!isResplit && (
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
              )}
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
        message={confirmMessage}
        confirmLabel={t('chapterSplit.confirmLabel')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={() => { setConfirmReplace(false); void apply(); }}
        onCancel={() => setConfirmReplace(false)}
      />
    </div>
  );
}
