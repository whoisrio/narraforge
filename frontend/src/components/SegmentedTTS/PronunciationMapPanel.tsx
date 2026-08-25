/**
 * 发音映射面板（Studio 内）：
 * - 项目字典 CRUD（写 project.configs.pronunciation_map，随整项目自动保存）
 * - 全局字典只读展示（「全局」徽标；被项目同名条目覆盖的灰显提示）
 * - 选中条目后用 useSegmentSearch 列出全项目命中段：复选框逐段应用 +
 *   全选 + 「替换后效果」预览（textTransforms 镜像计算，与后端一致）
 * - 项目设置开启 pronunciation_apply_all 时勾选列表置灰（全量自动生效）
 */
import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { PronunciationMapEntry, SegmentTextTransforms, SegmentedProject } from '../../types';
import { useSegmentSearch } from '../../hooks/useSegmentSearch';
import { applyPronunciationMap, mergePronunciationMaps } from '../../services/textTransforms';
import styles from './PronunciationMapPanel.module.css';

function newProjectMapId(): string {
  return `pm_${Math.random().toString(36).slice(2, 8)}`;
}

interface PronunciationMapPanelProps {
  open: boolean;
  project: SegmentedProject;
  /** 全局字典（/settings 维护），面板内只读 */
  globalMap: PronunciationMapEntry[];
  onClose: () => void;
  onUpdateProjectMeta: (meta: { pronunciation_map?: PronunciationMapEntry[] | null }) => void;
  onSetSegmentTransforms: (segmentId: string, transforms: SegmentTextTransforms | null) => void;
}

export function PronunciationMapPanel({
  open, project, globalMap, onClose, onUpdateProjectMeta, onSetSegmentTransforms,
}: PronunciationMapPanelProps) {
  const { t } = useTranslation();
  const projectMap = useMemo(
    () => ((project.configs?.pronunciation_map as PronunciationMapEntry[] | null | undefined) ?? []),
    [project.configs],
  );
  const applyAll = Boolean(project.configs?.pronunciation_apply_all);
  const merged = useMemo(() => mergePronunciationMaps(globalMap, projectMap), [globalMap, projectMap]);

  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEntry = merged.find(e => e.source === selectedSource) ?? null;
  const hits = useSegmentSearch(project, selectedEntry?.source ?? '');

  const segmentById = useMemo(() => {
    const m = new Map<string, { id: string; text: string; text_transforms?: SegmentTextTransforms | null }>();
    for (const ch of project.chapters) {
      for (const s of ch.segments) m.set(s.id, s);
    }
    return m;
  }, [project.chapters]);

  if (!open) return null;

  const handleAdd = () => {
    const src = source.trim();
    if (!src) { setError(t('pronunciationMap.errorSourceEmpty')); return; }
    if (projectMap.some(e => e.source === src)) { setError(t('pronunciationMap.errorSourceDuplicate')); return; }
    const entry: PronunciationMapEntry = {
      id: newProjectMapId(), source: src, target,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    onUpdateProjectMeta({ pronunciation_map: [...projectMap, entry] });
    setSource(''); setTarget(''); setNote(''); setError(null);
    setSelectedSource(src);
  };

  const handleDelete = (entry: PronunciationMapEntry) => {
    const referencing = project.chapters
      .flatMap(ch => ch.segments)
      .filter(s => (s.text_transforms?.applied_map_ids ?? []).includes(entry.id));
    const msg = referencing.length > 0
      ? t('pronunciationMap.deleteConfirmWithRefs', { count: referencing.length })
      : t('pronunciationMap.deleteConfirm');
    if (!window.confirm(msg)) return;
    for (const s of referencing) {
      const prev = s.text_transforms ?? {};
      onSetSegmentTransforms(s.id, {
        ...prev,
        applied_map_ids: (prev.applied_map_ids ?? []).filter(id => id !== entry.id),
      });
    }
    onUpdateProjectMeta({ pronunciation_map: projectMap.filter(e => e.id !== entry.id) });
    if (selectedSource === entry.source) setSelectedSource(null);
  };

  const handleToggleHit = (segmentId: string) => {
    if (!selectedEntry) return;
    const seg = segmentById.get(segmentId);
    const prev = seg?.text_transforms ?? {};
    const ids = new Set(prev.applied_map_ids ?? []);
    if (ids.has(selectedEntry.id)) ids.delete(selectedEntry.id);
    else ids.add(selectedEntry.id);
    onSetSegmentTransforms(segmentId, { ...prev, applied_map_ids: [...ids] });
  };

  const handleSelectAll = () => {
    if (!selectedEntry) return;
    for (const hit of hits) {
      const seg = segmentById.get(hit.segmentId);
      const prev = seg?.text_transforms ?? {};
      const ids = new Set(prev.applied_map_ids ?? []);
      if (!ids.has(selectedEntry.id)) {
        ids.add(selectedEntry.id);
        onSetSegmentTransforms(hit.segmentId, { ...prev, applied_map_ids: [...ids] });
      }
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-label={t('pronunciationMap.title')}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2>{t('pronunciationMap.title')}</h2>
          <button type="button" aria-label={t('common.close')} onClick={onClose}>×</button>
        </header>
        <p className={styles.desc}>{t('pronunciationMap.description')}</p>

        <div className={styles.addForm}>
          <input aria-label={t('pronunciationMap.sourceLabel')} placeholder={t('pronunciationMap.sourcePlaceholder')}
            value={source} onChange={(e) => setSource(e.target.value)} />
          <input aria-label={t('pronunciationMap.targetLabel')} placeholder={t('pronunciationMap.targetPlaceholder')}
            value={target} onChange={(e) => setTarget(e.target.value)} />
          <input aria-label={t('pronunciationMap.noteLabel')} placeholder={t('pronunciationMap.notePlaceholder')}
            value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" onClick={handleAdd}>{t('pronunciationMap.add')}</button>
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}

        <div className={styles.body}>
          <ul className={styles.entryList}>
            {merged.map((entry) => {
              const isGlobal = entry.id.startsWith('gpm_');
              const overridden = isGlobal && projectMap.some(e => e.source === entry.source);
              return (
                <li key={entry.id} className={styles.entryRow}>
                  <button
                    type="button"
                    className={`${styles.entry} ${selectedSource === entry.source ? styles.entryActive : ''} ${overridden ? styles.entryOverridden : ''}`}
                    onClick={() => setSelectedSource(entry.source)}
                  >
                    <span>{entry.source} {'->'} {entry.target}</span>
                    {isGlobal && <span className={styles.globalBadge}>{t('pronunciationMap.globalBadge')}</span>}
                    {overridden && <span className={styles.overriddenHint}>{t('pronunciationMap.overriddenHint')}</span>}
                  </button>
                  {!isGlobal && (
                    <button type="button" aria-label={t('pronunciationMap.delete')}
                      className={styles.deleteBtn} onClick={() => handleDelete(entry)}>🗑</button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className={styles.hits}>
            {selectedEntry && (
              <>
                {applyAll && <p className={styles.applyAllHint}>{t('pronunciationMap.applyAllActiveHint')}</p>}
                <div className={styles.hitsHeader}>
                  <span>{t('pronunciationMap.hitCount', { count: hits.length })}</span>
                  <button type="button" disabled={applyAll} onClick={handleSelectAll}>
                    {t('pronunciationMap.selectAll')}
                  </button>
                </div>
                <ul>
                  {hits.map((hit) => {
                    const seg = segmentById.get(hit.segmentId);
                    const applied = (seg?.text_transforms?.applied_map_ids ?? []).includes(selectedEntry.id);
                    const preview = seg ? applyPronunciationMap(seg.text, [selectedEntry]) : '';
                    return (
                      <li key={hit.segmentId} className={styles.hitRow}>
                        <label>
                          <input
                            type="checkbox"
                            disabled={applyAll}
                            checked={applyAll || applied}
                            onChange={() => handleToggleHit(hit.segmentId)}
                            aria-label={t('pronunciationMap.applyToSegment')}
                          />
                          <span className={styles.hitLoc}>{hit.chapterName} #{hit.position + 1}</span>
                        </label>
                        <span className={styles.hitPreview}>{preview}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
