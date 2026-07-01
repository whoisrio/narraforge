import { useEffect, useState } from 'react';
import type { Role, RoleSnapshot, EngineParams } from '../../types';
import { roleApi } from '../../services/api';
import { useTranslation } from '../../i18n';
import styles from './RoleLibraryPanel.module.css';

interface RoleLibraryPanelProps {
  open: boolean;
  onClose: () => void;
  onRolesChanged: (roles: Role[]) => void;
  projectId?: string | null;
}

function createEmptyRole(projectId?: string | null): RoleSnapshot {
  return {
    id: `role-${Date.now()}`,
    name: '',
    avatar: '',
    description: '',
    project_id: projectId ?? undefined,
    default_engine: 'edge_tts',
    default_voice: '',
    default_engine_params: { engine: 'edge_tts' },
    favorite_styles: [],
  };
}

function roleToDraft(role: Role): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    avatar: role.avatar,
    description: role.description,
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: { ...role.default_engine_params },
    favorite_styles: [...role.favorite_styles],
  };
}

export function RoleLibraryPanel({ open, onClose, onRolesChanged, projectId }: RoleLibraryPanelProps) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<Role[]>([]);
  const [draft, setDraft] = useState<RoleSnapshot>(() => createEmptyRole(projectId));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    roleApi.listRoles(projectId)
      .then((items) => {
        setRoles(items);
        onRolesChanged(items);
      })
      .catch(() => setError(t('segment.roleLibrary.loadFailed')));
  }, [open, onRolesChanged, t]);

  if (!open) return null;

  const saveDraft = async () => {
    if (!draft.name.trim()) {
      setError(t('segment.roleLibrary.nameEmpty'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const existing = roles.find((role) => role.id === draft.id);
      const saved = existing
        ? await roleApi.updateRole(draft.id, draft)
        : await roleApi.createRole(draft);
      const next = existing
        ? roles.map((role) => (role.id === saved.id ? saved : role))
        : [saved, ...roles];
      setRoles(next);
      onRolesChanged(next);
      setDraft(createEmptyRole(projectId));
    } catch {
      setError(t('segment.roleLibrary.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const removeRole = async (roleId: string) => {
    setError(null);
    try {
      await roleApi.deleteRole(roleId);
      const next = roles.filter((role) => role.id !== roleId);
      setRoles(next);
      onRolesChanged(next);
    } catch {
      setError(t('segment.roleLibrary.deleteFailed'));
    }
  };

  const setEngineParams = (params: Partial<EngineParams>) => {
    setDraft((prev) => ({
      ...prev,
      default_engine_params: { ...prev.default_engine_params, ...params },
    }));
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('segment.roleLibrary.title')}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2>{t('segment.roleLibrary.title')}</h2>
          <button type="button" onClick={onClose}>{t('segment.roleLibrary.close')}</button>
        </header>

        {error && <div className={styles.error}>{error}</div>}

        <section className={styles.editor}>
          <label>{t('segment.roleLibrary.name')}
            <input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} />
          </label>
          <label>{t('segment.roleLibrary.avatar')}
            <input value={draft.avatar ?? ''} onChange={(event) => setDraft((prev) => ({ ...prev, avatar: event.target.value }))} />
          </label>
          <label>{t('segment.roleLibrary.description')}
            <input value={draft.description ?? ''} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} />
          </label>
          <label>{t('segment.roleLibrary.engine')}
            <select
              value={draft.default_engine}
              onChange={(event) => {
                const engine = event.target.value as EngineParams['engine'];
                setDraft((prev) => ({ ...prev, default_engine: engine, default_engine_params: { ...prev.default_engine_params, engine } }));
              }}
            >
              <option value="edge_tts">Edge-TTS</option>
              <option value="cosyvoice">CosyVoice</option>
              <option value="mimo_tts">MiMo</option>
              <option value="voxcpm">VoxCPM</option>
            </select>
          </label>
          <label>{t('segment.roleLibrary.defaultVoice')}
            <input value={draft.default_voice ?? ''} onChange={(event) => setDraft((prev) => ({ ...prev, default_voice: event.target.value }))} />
          </label>
          <label>Edge voice
            <input value={(draft.default_engine_params as { voice?: string }).voice ?? ''} onChange={(event) => setEngineParams({ voice: event.target.value } as Partial<EngineParams>)} />
          </label>
          <button type="button" disabled={saving} onClick={() => void saveDraft()}>{saving ? t('common.saving') : t('segment.roleLibrary.save')}</button>
        </section>

        <section className={styles.list}>
          {roles.map((role) => (
            <article key={role.id} className={styles.roleCard}>
              <div>
                <strong>{role.name}</strong>
                <p>{role.default_engine} · {role.default_voice || t('segment.roleLibrary.noVoiceSet')}</p>
              </div>
              <div className={styles.actions}>
                <button type="button" onClick={() => setDraft(roleToDraft(role))}>{t('common.edit')}</button>
                <button type="button" onClick={() => void removeRole(role.id)}>{t('segment.roleLibrary.delete')}</button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
