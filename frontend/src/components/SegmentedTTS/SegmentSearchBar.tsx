/**
 * Studio 工具栏搜索框：全项目跨章节搜索（输入即搜），结果按章节分组，
 * ↑/↓ 移动、Enter 跳转、Esc 关闭；内置「含全大写词」快捷过滤器，
 * 该模式下每段带小写化三态开关（跟随项目 / 小写 / 保持大写）。
 */
import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { SegmentedProject } from '../../types';
import {
  findUppercaseSegments,
  splitSnippet,
  useSegmentSearch,
  type SegmentSearchHit,
} from '../../hooks/useSegmentSearch';
import { UPPERCASE_WORD_RE } from '../../services/textTransforms';
import styles from './SegmentSearchBar.module.css';

interface SegmentSearchBarProps {
  project: SegmentedProject;
  /** 点击/Enter 结果：父组件负责切章节 + 选中 + 滚动定位 */
  onNavigate: (hit: SegmentSearchHit) => void;
  /** 「含全大写词」模式下设置段级小写化覆盖（null=跟随项目） */
  onSetSegmentLowercase?: (segmentId: string, value: boolean | null) => void;
  /** 项目级 lowercase_latin 默认（三态「跟随项目」的状态提示用） */
  projectLowercaseLatin?: boolean;
}

function splitByRegex(snippet: string): { text: string; match: boolean }[] {
  const re = new RegExp(UPPERCASE_WORD_RE.source, 'g');
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ text: snippet.slice(last, idx), match: false });
    parts.push({ text: m[0], match: true });
    last = idx + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), match: false });
  return parts;
}

export function SegmentSearchBar({
  project, onNavigate, onSetSegmentLowercase, projectLowercaseLatin,
}: SegmentSearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [uppercaseOnly, setUppercaseOnly] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const queryHits = useSegmentSearch(project, query);
  const hits = useMemo(
    () => (uppercaseOnly ? findUppercaseSegments(project) : queryHits),
    [uppercaseOnly, project, queryHits],
  );

  const segmentTransforms = useMemo(() => {
    const m = new Map<string, boolean | null>();
    for (const ch of project.chapters) {
      for (const s of ch.segments) m.set(s.id, s.text_transforms?.lowercase_latin ?? null);
    }
    return m;
  }, [project.chapters]);

  // 按章节分组（保持命中数组顺序），键盘导航用扁平 hits
  const grouped = useMemo(() => {
    const groups: { chapterName: string; items: { hit: SegmentSearchHit; flatIndex: number }[] }[] = [];
    hits.forEach((hit, flatIndex) => {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.chapterName === hit.chapterName) {
        lastGroup.items.push({ hit, flatIndex });
      } else {
        groups.push({ chapterName: hit.chapterName, items: [{ hit, flatIndex }] });
      }
    });
    return groups;
  }, [hits]);

  const navigate = (hit: SegmentSearchHit) => {
    onNavigate(hit);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex(i => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = hits[Math.max(0, Math.min(activeIndex, hits.length - 1))];
      if (hit) navigate(hit);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const renderSnippet = (hit: SegmentSearchHit) => {
    const parts = uppercaseOnly ? splitByRegex(hit.snippet) : splitSnippet(hit.snippet, query);
    return parts.map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>));
  };

  const showPanel = open && (uppercaseOnly || query.trim().length > 0);

  return (
    <div className={styles.root}>
      <input
        className={styles.input}
        aria-label={t('segmentSearch.placeholder').replace(/…$/, '')}
        placeholder={t('segmentSearch.placeholder')}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setUppercaseOnly(false); setOpen(true); setActiveIndex(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        aria-label={t('segmentSearch.uppercaseFilter')}
        aria-pressed={uppercaseOnly}
        className={`${styles.filterChip} ${uppercaseOnly ? styles.filterChipActive : ''}`}
        onClick={() => { setUppercaseOnly(v => !v); setOpen(true); setActiveIndex(0); }}
      >
        {t('segmentSearch.uppercaseFilter')}
      </button>
      {showPanel && (
        <div className={styles.results} role="listbox" aria-label={t('segmentSearch.results')}>
          <div className={styles.summary}>
            {hits.length > 0 ? t('segmentSearch.hitCount', { count: hits.length }) : t('segmentSearch.noResults')}
          </div>
          {grouped.map(group => (
            <div key={group.chapterName} className={styles.group}>
              <div className={styles.groupName}>{group.chapterName}</div>
              {group.items.map(({ hit, flatIndex }) => (
                <div
                  key={hit.segmentId}
                  role="option"
                  aria-selected={flatIndex === activeIndex}
                  aria-label={hit.snippet}
                  className={`${styles.hit} ${flatIndex === activeIndex ? styles.hitActive : ''}`}
                  onClick={() => navigate(hit)}
                  onMouseEnter={() => setActiveIndex(flatIndex)}
                >
                  <span className={styles.hitPos}>#{hit.position + 1}</span>
                  <span className={styles.hitSnippet}>{renderSnippet(hit)}</span>
                  {hit.matchCount > 1 && <span className={styles.hitCount}>×{hit.matchCount}</span>}
                  {uppercaseOnly && onSetSegmentLowercase && (
                    <span className={styles.lowerTri} onClick={(e) => e.stopPropagation()}>
                      {([null, true, false] as const).map(v => (
                        <button
                          key={String(v)}
                          type="button"
                          aria-pressed={(segmentTransforms.get(hit.segmentId) ?? null) === v}
                          className={`${styles.lowerBtn} ${(segmentTransforms.get(hit.segmentId) ?? null) === v ? styles.lowerBtnActive : ''}`}
                          aria-label={v === null ? t('segmentSearch.lowerFollow') : v ? t('segmentSearch.lowerOn') : t('segmentSearch.lowerOff')}
                          title={v === null
                            ? `${t('segmentSearch.lowerFollow')}: ${projectLowercaseLatin ? t('segmentSearch.lowerOn') : t('segmentSearch.lowerOff')}`
                            : undefined}
                          onClick={() => onSetSegmentLowercase(hit.segmentId, v)}
                        >
                          {v === null ? t('segmentSearch.lowerFollow') : v ? t('segmentSearch.lowerOn') : t('segmentSearch.lowerOff')}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
