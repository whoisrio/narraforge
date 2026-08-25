/**
 * 全局发音字典编辑器（/settings）：增删改后全量 PUT。
 * 全局条目 id 统一 gpm_ 前缀（项目字典 pm_ 前缀，两层永不冲突）。
 * 保存前 confirm 提示影响范围（改动对所有项目生效）。
 */
import { useCallback, useEffect, useState } from 'react';
import { configApi } from '../../services/api';
import { useTranslation } from '../../i18n';
import type { PronunciationMapEntry } from '../../types';
import styles from './PronunciationMapSetting.module.css';

interface Status {
  type: 'success' | 'error';
  message: string;
}

function extractDetail(err: unknown): string {
  const resp = (err as { response?: { data?: { detail?: unknown } } })?.response;
  const detail = resp?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object' && detail !== null && 'message' in detail) {
    return (detail as { message: string }).message;
  }
  return String(err);
}

function newGlobalMapId(): string {
  return `gpm_${Math.random().toString(36).slice(2, 8)}`;
}

export function PronunciationMapSetting() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PronunciationMapEntry[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    configApi.getPronunciationMapGlobal()
      .then((res) => { if (alive) setEntries(res.entries ?? []); })
      .catch(() => { /* 读取失败按空表处理，仍可编辑 */ });
    return () => { alive = false; };
  }, []);

  const updateEntry = (id: string, patch: Partial<PronunciationMapEntry>) => {
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  };

  const handleAdd = () => {
    setEntries(prev => [...prev, { id: newGlobalMapId(), source: '', target: '' }]);
  };

  const handleDelete = (id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const handleSave = useCallback(async () => {
    if (!window.confirm(t('settings.pronunciationMap.saveConfirm'))) return;
    setBusy(true);
    setStatus(null);
    try {
      const payload = entries.map(e => ({ ...e, source: e.source.trim(), target: e.target }));
      const res = await configApi.setPronunciationMapGlobal(payload);
      setEntries(res.entries ?? []);
      setStatus({ type: 'success', message: t('settings.pronunciationMap.saveSuccess') });
    } catch (err) {
      setStatus({ type: 'error', message: extractDetail(err) });
    } finally {
      setBusy(false);
    }
  }, [entries, t]);

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>{t('settings.pronunciationMap.kicker')}</span>
          <h2 className={styles.title}>{t('settings.pronunciationMap.title')}</h2>
          <p className={styles.desc}>{t('settings.pronunciationMap.description')}</p>
        </div>
      </header>
      <div className={styles.body}>
        {entries.length === 0 && <p className={styles.empty}>{t('settings.pronunciationMap.empty')}</p>}
        <div className={styles.rowHeader}>
          <span>{t('settings.pronunciationMap.source')}</span>
          <span>{t('settings.pronunciationMap.target')}</span>
          <span>{t('settings.pronunciationMap.note')}</span>
          <span aria-hidden="true" />
        </div>
        {entries.map((entry) => (
          <div key={entry.id} className={styles.row}>
            <input aria-label={t('settings.pronunciationMap.source')} value={entry.source}
              onChange={(e) => updateEntry(entry.id, { source: e.target.value })} />
            <input aria-label={t('settings.pronunciationMap.target')} value={entry.target}
              onChange={(e) => updateEntry(entry.id, { target: e.target.value })} />
            <input aria-label={t('settings.pronunciationMap.note')} value={entry.note ?? ''}
              onChange={(e) => updateEntry(entry.id, { note: e.target.value || undefined })} />
            <button type="button" aria-label={t('settings.pronunciationMap.deleteRow')}
              className={styles.deleteBtn} onClick={() => handleDelete(entry.id)}>🗑</button>
          </div>
        ))}
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={handleAdd}>
            {t('settings.pronunciationMap.add')}
          </button>
          <button type="button" className={styles.primary} onClick={handleSave} disabled={busy}>
            {t('common.save')}
          </button>
        </div>
        {status && (
          <p role="alert" className={status.type === 'success' ? styles.success : styles.error}>
            {status.message}
          </p>
        )}
      </div>
    </section>
  );
}
