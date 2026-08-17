import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import { useAuth } from '../hooks/authContext';
import {
  adminApi,
  errorStatus,
  type AdminLogItem,
  type AdminOverview,
  type AdminUserItem,
  type Paginated,
} from '../services/adminApi';
import styles from './Admin.module.css';

const PAGE_SIZE = 20;

function formatTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/** 简单内联 SVG 柱状图（不引入图表库）：单列或登录/匿名堆叠两种序列。 */
function BarChart({
  series,
  testId,
}: {
  series: { date: string; values: number[] }[];
  testId: string;
}) {
  if (series.length === 0) return null;
  const width = 720;
  const height = 140;
  const pad = 8;
  const max = Math.max(1, ...series.map((p) => p.values.reduce((a, b) => a + b, 0)));
  const slot = (width - pad * 2) / series.length;
  const barWidth = Math.min(18, slot * 0.6);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={styles.chart}
      role="img"
      data-testid={testId}
      preserveAspectRatio="none"
    >
      {series.map((point, i) => {
        const x = pad + i * slot + (slot - barWidth) / 2;
        let yCursor = height - pad;
        return (
          <g key={point.date || i}>
            {point.values.map((v, layer) => {
              const h = ((height - pad * 2) * v) / max;
              yCursor -= h;
              return (
                <rect
                  key={layer}
                  x={x}
                  y={yCursor}
                  width={barWidth}
                  height={h}
                  rx={1.5}
                  className={layer === 0 ? styles.barPrimary : styles.barSecondary}
                >
                  <title>{`${point.date}: ${v}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

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
        {t('admin.prevPage')}
      </button>
      <span className={styles.pageInfo}>{t('admin.pageInfo', { page, totalPages })}</span>
      <button
        type="button"
        className={styles.pageButton}
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        {t('admin.nextPage')}
      </button>
    </div>
  );
}

type LoadState<T> =
  | { kind: 'loading' }
  | { kind: 'error'; forbidden: boolean }
  | { kind: 'ready'; data: T };

function SectionState({ state, onRetry }: { state: LoadState<unknown>; onRetry: () => void }) {
  const { t } = useTranslation();
  if (state.kind === 'ready') return null;
  if (state.kind === 'loading') {
    return <p className={styles.stateText}>{t('admin.loading')}</p>;
  }
  return (
    <div className={styles.stateBox}>
      <p className={styles.stateText}>{state.forbidden ? t('admin.forbidden') : t('admin.loadFailed')}</p>
      {!state.forbidden && (
        <button type="button" className={styles.pageButton} onClick={onRetry}>
          {t('admin.retry')}
        </button>
      )}
    </div>
  );
}

/**
 * 管理后台（spec 5.2c · M7）：总览卡片 + 30 日趋势 + 用户表 + 操作日志。
 * 仅 isAdmin 用户可见入口；接口返回 403 admin_required 时各区块显示无权限。
 */
export function Admin() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  const [overview, setOverview] = useState<LoadState<AdminOverview>>({ kind: 'loading' });
  const [users, setUsers] = useState<LoadState<Paginated<AdminUserItem>>>({ kind: 'loading' });
  const [logs, setLogs] = useState<LoadState<Paginated<AdminLogItem>>>({ kind: 'loading' });
  const [userPage, setUserPage] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<{ action: string; date: string }>({ action: '', date: '' });

  const toError = useCallback((err: unknown): LoadState<never> => ({
    kind: 'error',
    forbidden: errorStatus(err) === 403,
  }), []);

  // 加载函数本身只做异步取数（loading 态由初始值 / 事件处理器设置），
  // 避免在 effect 里同步 setState（react-hooks/set-state-in-effect）。
  const loadOverview = useCallback(() => {
    adminApi.getOverview()
      .then((data) => setOverview({ kind: 'ready', data }))
      .catch((err) => setOverview(toError(err)));
  }, [toError]);

  const loadUsers = useCallback((page: number) => {
    adminApi.getUsers(page, PAGE_SIZE)
      .then((data) => setUsers({ kind: 'ready', data }))
      .catch((err) => setUsers(toError(err)));
  }, [toError]);

  const loadLogs = useCallback((page: number, filters: { action: string; date: string }) => {
    adminApi.getLogs(page, PAGE_SIZE, {
      action: filters.action || undefined,
      date: filters.date || undefined,
    })
      .then((data) => setLogs({ kind: 'ready', data }))
      .catch((err) => setLogs(toError(err)));
  }, [toError]);

  useEffect(() => { if (isAdmin) loadOverview(); }, [isAdmin, loadOverview]);
  useEffect(() => { if (isAdmin) loadUsers(userPage); }, [isAdmin, loadUsers, userPage]);
  useEffect(() => { if (isAdmin) loadLogs(logPage, appliedFilters); }, [isAdmin, loadLogs, logPage, appliedFilters]);

  if (!isAdmin) {
    return (
      <div className={styles.page} data-testid="admin-forbidden">
        <p className={styles.stateText}>{t('admin.forbidden')}</p>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="admin-page">
      <header className={styles.header}>
        <h1 className={styles.title}>{t('admin.title')}</h1>
        <p className={styles.subtitle}>{t('admin.subtitle')}</p>
      </header>

      {/* ── 总览 ── */}
      <section className={styles.section} aria-label={t('admin.overview')}>
        <h2 className={styles.sectionTitle}>{t('admin.overview')}</h2>
        {overview.kind !== 'ready' ? (
          <SectionState state={overview} onRetry={() => { setOverview({ kind: 'loading' }); loadOverview(); }} />
        ) : (
          <>
            <div className={styles.cards}>
              <div className={styles.card}>
                <span className={styles.cardLabel}>{t('admin.totalUsers')}</span>
                <span className={styles.cardValue} data-testid="admin-total-users">{overview.data.total_users}</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>{t('admin.todayDau')}</span>
                <span className={styles.cardValue} data-testid="admin-today-dau">{overview.data.today_dau}</span>
              </div>
            </div>
            <div className={styles.chartBlock}>
              <h3 className={styles.chartTitle}>{t('admin.dauTrend')}</h3>
              <BarChart testId="admin-dau-chart" series={overview.data.dau_series.map((p) => ({ date: p.date, values: [p.count] }))} />
            </div>
            <div className={styles.chartBlock}>
              <h3 className={styles.chartTitle}>{t('admin.visitTrend')}</h3>
              <div className={styles.legend}>
                <span className={styles.legendItem}><i className={styles.legendPrimary} />{t('admin.authed')}</span>
                <span className={styles.legendItem}><i className={styles.legendSecondary} />{t('admin.anon')}</span>
              </div>
              <BarChart testId="admin-visit-chart" series={overview.data.visit_series.map((p) => ({ date: p.date, values: [p.authed, p.anon] }))} />
            </div>
          </>
        )}
      </section>

      {/* ── 用户 ── */}
      <section className={styles.section} aria-label={t('admin.users')}>
        <h2 className={styles.sectionTitle}>{t('admin.users')}</h2>
        {users.kind !== 'ready' ? (
          <SectionState state={users} onRetry={() => { setUsers({ kind: 'loading' }); loadUsers(userPage); }} />
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('admin.email')}</th>
                  <th>{t('admin.role')}</th>
                  <th>{t('admin.createdAt')}</th>
                  <th>{t('admin.lastSeenAt')}</th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.length === 0 && (
                  <tr><td colSpan={4} className={styles.emptyCell}>{t('admin.empty')}</td></tr>
                )}
                {users.data.items.map((u) => (
                  <tr key={u.id || u.email}>
                    <td>{u.email}</td>
                    <td>{u.is_admin ? <span className={styles.badge}>{t('admin.adminBadge')}</span> : '—'}</td>
                    <td>{formatTime(u.created_at)}</td>
                    <td>{formatTime(u.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={users.data.page} total={users.data.total} pageSize={users.data.page_size} onPage={setUserPage} />
          </>
        )}
      </section>

      {/* ── 操作日志 ── */}
      <section className={styles.section} aria-label={t('admin.logs')}>
        <h2 className={styles.sectionTitle}>{t('admin.logs')}</h2>
        <form
          className={styles.filters}
          onSubmit={(e) => {
            e.preventDefault();
            setLogPage(1);
            setAppliedFilters({ action: actionFilter.trim(), date: dateFilter });
          }}
        >
          <input
            type="text"
            className={styles.filterInput}
            placeholder={t('admin.actionFilter')}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          />
          <input
            type="date"
            className={styles.filterInput}
            aria-label={t('admin.time')}
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
          <button type="submit" className={styles.pageButton}>{t('admin.applyFilter')}</button>
          <button
            type="button"
            className={styles.pageButton}
            onClick={() => {
              setActionFilter('');
              setDateFilter('');
              setLogPage(1);
              setAppliedFilters({ action: '', date: '' });
            }}
          >
            {t('admin.resetFilter')}
          </button>
        </form>
        {logs.kind !== 'ready' ? (
          <SectionState state={logs} onRetry={() => { setLogs({ kind: 'loading' }); loadLogs(logPage, appliedFilters); }} />
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('admin.time')}</th>
                  <th>{t('admin.user')}</th>
                  <th>{t('admin.action')}</th>
                  <th>{t('admin.request')}</th>
                  <th>{t('admin.status')}</th>
                  <th>{t('admin.duration')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.items.length === 0 && (
                  <tr><td colSpan={6} className={styles.emptyCell}>{t('admin.empty')}</td></tr>
                )}
                {logs.data.items.map((log) => (
                  <tr key={log.id || `${log.created_at}-${log.path}`}>
                    <td>{formatTime(log.created_at)}</td>
                    <td className={styles.monoCell}>{log.user_id ?? '—'}</td>
                    <td>{log.action}</td>
                    <td className={styles.monoCell}>{[log.method, log.path].filter(Boolean).join(' ') || '—'}</td>
                    <td>{log.status ?? '—'}</td>
                    <td>{log.duration_ms != null ? `${log.duration_ms}ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={logs.data.page} total={logs.data.total} pageSize={logs.data.page_size} onPage={setLogPage} />
          </>
        )}
      </section>
    </div>
  );
}
