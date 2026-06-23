import { useEffect, useState } from 'react';
import type { Role, RoleSnapshot, SegmentEngineParams } from '../../types';
import { roleApi } from '../../services/api';
import styles from './RoleLibraryPanel.module.css';

interface RoleLibraryPanelProps {
  open: boolean;
  onClose: () => void;
  onRolesChanged: (roles: Role[]) => void;
}

function createEmptyRole(): RoleSnapshot {
  return {
    id: `role-${Date.now()}`,
    name: '新角色',
    avatar: '',
    description: '',
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

export function RoleLibraryPanel({ open, onClose, onRolesChanged }: RoleLibraryPanelProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [draft, setDraft] = useState<RoleSnapshot>(createEmptyRole);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    roleApi.listRoles()
      .then((items) => {
        setRoles(items);
        onRolesChanged(items);
      })
      .catch(() => setError('角色库加载失败'));
  }, [open, onRolesChanged]);

  if (!open) return null;

  const saveDraft = async () => {
    if (!draft.name.trim()) {
      setError('角色名不能为空');
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
      setDraft(createEmptyRole());
    } catch {
      setError('角色保存失败');
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
      setError('角色删除失败');
    }
  };

  const setEngineParams = (params: Partial<SegmentEngineParams>) => {
    setDraft((prev) => ({
      ...prev,
      default_engine_params: { ...prev.default_engine_params, ...params },
    }));
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="角色库">
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2>全局角色库</h2>
          <button type="button" onClick={onClose}>关闭</button>
        </header>

        {error && <div className={styles.error}>{error}</div>}

        <section className={styles.editor}>
          <label>角色名
            <input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} />
          </label>
          <label>头像
            <input value={draft.avatar ?? ''} onChange={(event) => setDraft((prev) => ({ ...prev, avatar: event.target.value }))} />
          </label>
          <label>描述
            <input value={draft.description ?? ''} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} />
          </label>
          <label>引擎
            <select
              value={draft.default_engine}
              onChange={(event) => {
                const engine = event.target.value as SegmentEngineParams['engine'];
                setDraft((prev) => ({ ...prev, default_engine: engine, default_engine_params: { ...prev.default_engine_params, engine } }));
              }}
            >
              <option value="edge_tts">Edge-TTS</option>
              <option value="cosyvoice">CosyVoice</option>
              <option value="mimo_tts">MiMo</option>
              <option value="voxcpm">VoxCPM</option>
            </select>
          </label>
          <label>默认音色
            <input value={draft.default_voice ?? ''} onChange={(event) => setDraft((prev) => ({ ...prev, default_voice: event.target.value }))} />
          </label>
          <label>Edge voice
            <input value={draft.default_engine_params.edge_voice ?? ''} onChange={(event) => setEngineParams({ edge_voice: event.target.value })} />
          </label>
          <button type="button" disabled={saving} onClick={() => void saveDraft()}>{saving ? '保存中...' : '保存角色'}</button>
        </section>

        <section className={styles.list}>
          {roles.map((role) => (
            <article key={role.id} className={styles.roleCard}>
              <div>
                <strong>{role.name}</strong>
                <p>{role.default_engine} · {role.default_voice || '未设置音色'}</p>
              </div>
              <div className={styles.actions}>
                <button type="button" onClick={() => setDraft(roleToDraft(role))}>编辑</button>
                <button type="button" onClick={() => void removeRole(role.id)}>删除</button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
