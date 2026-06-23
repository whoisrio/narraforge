import type { Role, RoleSnapshot } from '../../types';
import { DEFAULT_EDGE_NARRATOR_VOICE } from '../../services/voiceRoleDefaults';
import styles from './ProjectVoices.module.css';

interface ProjectVoicesProps {
  roles: Role[];
  defaultNarratorRoleId?: string | null;
  onSetDefaultNarrator: (roleId: string | null, roleSnapshot: RoleSnapshot | null) => void;
  onCreateDefaultNarrator: () => void;
  onCreateCast: () => void;
  onPreviewRole: (role: Role, sampleText: string) => void;
  onManageRoles: () => void;
  defaultNarratorPreviewLabel?: string;
}

const NARRATOR_SAMPLE = '这是一段默认旁白试听，用于确认叙述声音是否沉稳、清晰，并适合长时间解说。';
const CAST_SAMPLE = '你好，我是这个角色的声音。请确认语气、节奏和音色是否符合当前场景。';

function roleToSnapshot(role: Role): RoleSnapshot {
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

function isNarratorRole(role: Role, defaultNarratorRoleId?: string | null): boolean {
  const text = `${role.name} ${role.description ?? ''}`.toLowerCase();
  return role.id === defaultNarratorRoleId || text.includes('narrator') || text.includes('旁白');
}

function engineLabel(role: Role): string {
  const labels: Record<string, string> = {
    edge_tts: 'Edge-TTS',
    cosyvoice: 'CosyVoice',
    mimo_tts: 'MiMo',
    voxcpm: 'VoxCPM',
  };
  return labels[role.default_engine] ?? role.default_engine;
}

function roleVoiceLabel(role: Role): string {
  return role.default_voice || role.default_engine_params.edge_voice || role.default_engine_params.voice_id || role.default_engine_params.mimo_preset_voice || '未设置音色';
}

export function ProjectVoices({
  roles,
  defaultNarratorRoleId,
  onSetDefaultNarrator,
  onCreateDefaultNarrator,
  onCreateCast,
  onPreviewRole,
  onManageRoles,
  defaultNarratorPreviewLabel = `Edge-TTS · ${DEFAULT_EDGE_NARRATOR_VOICE}`,
}: ProjectVoicesProps) {
  const narratorRoles = roles.filter(role => isNarratorRole(role, defaultNarratorRoleId));
  const castRoles = roles.filter(role => !isNarratorRole(role, defaultNarratorRoleId));
  const defaultNarrator = defaultNarratorRoleId
    ? roles.find(role => role.id === defaultNarratorRoleId) ?? null
    : null;

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Voices</span>
          <h2>声音角色</h2>
          <p>先配置默认旁白和 Cast 角色，再进入 Studio 分配到旁白段与台词段。</p>
        </div>
        <button type="button" className={styles.ghostButton} onClick={onManageRoles}>管理角色库</button>
      </header>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.kicker}>Narrator</span>
              <h3>默认旁白</h3>
            </div>
            <button type="button" className={styles.primaryButton} onClick={onCreateDefaultNarrator}>创建默认旁白</button>
          </div>

          <label className={styles.defaultPicker}>
            <span>默认旁白角色</span>
            <select
              value={defaultNarrator?.id ?? ''}
              onChange={(event) => {
                const role = roles.find(item => item.id === event.target.value);
                onSetDefaultNarrator(role?.id ?? null, role ? roleToSnapshot(role) : null);
              }}
            >
              <option value="">未选择</option>
              {narratorRoles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>

          {defaultNarrator ? (
            <article className={styles.roleCard}>
              <div className={styles.avatar}>{defaultNarrator.name.slice(0, 1)}</div>
              <div className={styles.roleBody}>
                <strong>{defaultNarrator.name}</strong>
                <span>{engineLabel(defaultNarrator)} · {roleVoiceLabel(defaultNarrator)}</span>
                <p>{NARRATOR_SAMPLE}</p>
              </div>
              <button type="button" onClick={() => onPreviewRole(defaultNarrator, NARRATOR_SAMPLE)}>试听</button>
            </article>
          ) : (
            <div className={styles.emptyState}>
              <strong>还没有默认旁白</strong>
              <p>创建一个默认旁白角色，用于所有 narration 段落。</p>
              <div className={styles.defaultVoiceHint}>
                <span>创建后将使用</span>
                <strong>{defaultNarratorPreviewLabel}</strong>
              </div>
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.kicker}>Cast</span>
              <h3>对话角色</h3>
            </div>
            <button type="button" className={styles.primaryButton} onClick={onCreateCast}>新增 Cast</button>
          </div>

          <div className={styles.castList}>
            {castRoles.length === 0 && (
              <div className={styles.emptyState}>
                <strong>还没有 Cast 角色</strong>
                <p>对话/剧本模式会把台词段分配给 Cast。先创建嘉宾或角色声音。</p>
              </div>
            )}
            {castRoles.map(role => (
              <article key={role.id} className={styles.roleCard}>
                <div className={styles.avatar}>{role.name.slice(0, 1)}</div>
                <div className={styles.roleBody}>
                  <strong>{role.name}</strong>
                  <span>{engineLabel(role)} · {roleVoiceLabel(role)}</span>
                  <p>{CAST_SAMPLE}</p>
                </div>
                <button type="button" onClick={() => onPreviewRole(role, CAST_SAMPLE)}>试听</button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
