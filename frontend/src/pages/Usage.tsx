import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import { usageApi, type GlobalUsage, type GlobalUsageProject } from '../services/usageApi';
import styles from './Usage.module.css';

const PAGE_SIZE = 20;

function Pagination({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className={styles.pagination}>
      <button type="button" className={styles.pageButton} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('usage.prevPage')}
      </button>
      <span className={styles.pageInfo}>{t('usage.pageInfo', { page, totalPages })}</span>
      <button
        type="button"
        className={styles.pageButton}
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        {t('usage.nextPage')}
      </button>
    </div>
  );
}

type LoadState<T> =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; data: T };

function SectionState({ state, onRetry }: { state: LoadState<unknown>; onRetry: () => void }) {
  const { t } = useTranslation();
  if (state.kind === 'ready') return null;
  if (state.kind === 'loading') {
    return <p className={styles.stateText}>{t('usage.loading')}</p>;
  }
  return (
    <div className={styles.stateBox}>
      <p className={styles.stateText}>{t('usage.loadFailed')}</p>
      <button type="button" className={styles.pageButton} onClick={onRetry}>
        {t('usage.retry')}
      </button>
    </div>
  );
}

/** 行内横向用量条（不引入图表库）：按字数相对最大值缩放。 */
function UsageBar({ project, maxChars }: { project: GlobalUsageProject; maxChars: number }) {
  const width = Math.round((project.chars / maxChars) * 100);
  return (
    <svg
      viewBox="0 0 100 8"
      className={styles.rowBar}
      role="img"
      data-testid={`usage-bar-${project.project_id}`}
      preserveAspectRatio="none"
    >
      <rect x={0} y={0} width={width} height={8} rx={1.5} className={styles.barPrimary}>
        <title>{`${project.project_name}: ${project.chars}`}</title>
      </rect>
    </svg>
  );
}

/**
 * 全局用量页：当前用户各项目 TTS 次数 / 字数 / Token 用量合计 + 按项目明细。
 * workers 模式匿名用户被 hiddenNavIds 隐藏入口（401）；本地模式返回单租户合计。
 */
export function Usage() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<LoadState<GlobalUsage>>({ kind: 'loading' });
  const [page, setPage] = useState(1);

  // 加载函数只做异步取数（loading 态由初始值 / 重试处理器设置），
  // 避免在 effect 里同步 setState（react-hooks/set-state-in-effect）。
  const load = useCallback(() => {
    usageApi.getMyUsage()
      .then((data) => setUsage({ kind: 'ready', data }))
      .catch(() => setUsage({ kind: 'error' }));
  }, []);

  useEffect(() => { load(); }, [load]);

  const projects = usage.kind === 'ready' ? usage.data.projects : [];
  const pageItems = projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const maxChars = Math.max(1, ...projects.map((p) => p.chars));

  return (
    <div className={styles.page} data-testid="usage-page">
      <header className={styles.header}>
        <h1 className={styles.title}>{t('usage.title')}</h1>
        <p className={styles.subtitle}>{t('usage.subtitle')}</p>
      </header>

      {/* ── 合计 ── */}
      <section className={styles.section} aria-label={t('usage.title')}>
        {usage.kind !== 'ready' ? (
          <SectionState state={usage} onRetry={() => { setUsage({ kind: 'loading' }); load(); }} />
        ) : (
          <div className={styles.cards}>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t('usage.statTts')}</span>
              <span className={styles.cardValue} data-testid="usage-total-tts">{usage.data.totals.tts_count}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t('usage.statChars')}</span>
              <span className={styles.cardValue} data-testid="usage-total-chars">{usage.data.totals.chars}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t('usage.statInputTokens')}</span>
              <span className={styles.cardValue} data-testid="usage-total-input-tokens">{usage.data.totals.input_tokens}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t('usage.statOutputTokens')}</span>
              <span className={styles.cardValue} data-testid="usage-total-output-tokens">{usage.data.totals.output_tokens}</span>
            </div>
          </div>
        )}
      </section>

      {/* ── 按项目 ── */}
      <section className={styles.section} aria-label={t('usage.perProject')}>
        <h2 className={styles.sectionTitle}>{t('usage.perProject')}</h2>
        {usage.kind === 'ready' && (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('usage.projectName')}</th>
                  <th>{t('usage.statTts')}</th>
                  <th>{t('usage.statChars')}</th>
                  <th>{t('usage.statInputTokens')}</th>
                  <th>{t('usage.statOutputTokens')}</th>
                  <th>{t('usage.usageBar')}</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 && (
                  <tr><td colSpan={6} className={styles.emptyCell}>{t('usage.empty')}</td></tr>
                )}
                {pageItems.map((p) => (
                  <tr key={p.project_id || p.project_name}>
                    <td>{p.project_name || p.project_id}</td>
                    <td>{p.tts_count}</td>
                    <td>{p.chars}</td>
                    <td>{p.input_tokens}</td>
                    <td>{p.output_tokens}</td>
                    <td className={styles.barCell}><UsageBar project={p} maxChars={maxChars} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} total={projects.length} pageSize={PAGE_SIZE} onPage={setPage} />
            <p className={styles.footnote}>{t('usage.tokenEstimateNote')}</p>
          </>
        )}
      </section>
    </div>
  );
}
