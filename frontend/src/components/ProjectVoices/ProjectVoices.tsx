import { useState } from 'react';
import type { Role, RoleSnapshot, SegmentEngineParams } from '../../types';
import { DEFAULT_EDGE_CAST_VOICE, DEFAULT_EDGE_NARRATOR_VOICE } from '../../services/voiceRoleDefaults';
import styles from './ProjectVoices.module.css';

interface ProjectVoicesProps {
  roles: Role[];
  defaultNarratorRoleId?: string | null;
  onSetDefaultNarrator: (roleId: string | null, roleSnapshot: RoleSnapshot | null) => void;
  onCreateDefaultNarrator: () => void;
  onCreateCast: () => void;
  onSaveRole?: (role: RoleSnapshot) => void;
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

function createRoleDraft(kind: 'Narrator' | 'Cast'): RoleSnapshot {
  const edgeVoice = kind === 'Narrator' ? DEFAULT_EDGE_NARRATOR_VOICE : DEFAULT_EDGE_CAST_VOICE;
  return {
    id: `role-${kind.toLowerCase()}-${Date.now()}`,
    name: kind === 'Narrator' ? '默认旁白' : '新 Cast',
    avatar: '',
    description: kind,
    default_engine: 'edge_tts',
    default_voice: edgeVoice,
    default_engine_params: { engine: 'edge_tts', edge_voice: edgeVoice, edge_rate: '+0%', edge_volume: '+0%' },
    favorite_styles: [],
  };
}

function normalizeDraftForSave(draft: RoleSnapshot): RoleSnapshot {
  const params = { ...draft.default_engine_params, engine: draft.default_engine } as SegmentEngineParams;
  const defaultVoice = draft.default_engine === 'edge_tts'
    ? params.edge_voice ?? ''
    : draft.default_engine === 'cosyvoice'
      ? params.voice_id ?? ''
      : draft.default_engine === 'mimo_tts'
        ? params.mimo_clone_voice_id || params.mimo_preset_voice || ''
        : params.voice_id || params.voxcpm_voice_description || '';
  return { ...draft, default_voice: defaultVoice, default_engine_params: params };
}

function VoiceRoleEditor({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: RoleSnapshot;
  onChange: (draft: RoleSnapshot) => void;
  onCancel: () => void;
  onSave: (draft: RoleSnapshot) => void;
}) {
  const params = draft.default_engine_params;
  const setEngine = (engine: SegmentEngineParams['engine']) => {
    const nextParams: SegmentEngineParams = engine === 'edge_tts'
      ? { engine, edge_voice: params.edge_voice || DEFAULT_EDGE_CAST_VOICE, edge_rate: params.edge_rate || '+0%', edge_volume: params.edge_volume || '+0%' }
      : engine === 'cosyvoice'
        ? { engine, voice_id: params.voice_id || '', speed: params.speed ?? 1, volume: params.volume ?? 80, pitch: params.pitch ?? 1, language: params.language || 'Chinese', instruction: params.instruction || '' }
        : engine === 'mimo_tts'
          ? { engine, mimo_mode: params.mimo_mode || 'preset', mimo_preset_voice: params.mimo_preset_voice || '冰糖', mimo_instruction: params.mimo_instruction || '' }
          : { engine, voxcpm_mode: params.voxcpm_mode || 'tts', voice_id: params.voice_id || '', voxcpm_voice_description: params.voxcpm_voice_description || '', voxcpm_style_control: params.voxcpm_style_control || '', voxcpm_prompt_text: params.voxcpm_prompt_text || '', voxcpm_cfg_value: params.voxcpm_cfg_value ?? 2, voxcpm_inference_timesteps: params.voxcpm_inference_timesteps ?? 10 };
    onChange({ ...draft, default_engine: engine, default_engine_params: nextParams });
  };
  const setParams = (next: Partial<SegmentEngineParams>) => onChange({
    ...draft,
    default_engine_params: { ...draft.default_engine_params, ...next, engine: draft.default_engine } as SegmentEngineParams,
  });

  return (
    <section className={styles.editorPanel} aria-label="声音角色编辑器">
      <div className={styles.editorHero}>
        <div className={styles.editorAvatar}>{draft.name.slice(0, 1) || '声'}</div>
        <div>
          <span className={styles.kicker}>Voice Role</span>
          <h3>声音角色配置</h3>
          <p>{draft.description === 'Narrator' ? '默认旁白声音' : 'Cast 对话角色'} · 配置模型、音色与参数。</p>
        </div>
        <div className={styles.editorActions}>
          <button type="button" className={styles.ghostButton} onClick={onCancel}>取消</button>
          <button type="button" className={styles.primaryButton} onClick={() => onSave(normalizeDraftForSave(draft))}>保存角色</button>
        </div>
      </div>

      <div className={styles.editorGrid}>
        <div className={styles.editorMain}>
          <section className={styles.configCard}>
            <h4>Role Identity</h4>
            <label>角色名
              <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
            </label>
            <label>角色类型
              <select value={draft.description ?? 'Cast'} onChange={(event) => onChange({ ...draft, description: event.target.value })}>
                <option value="Narrator">Narrator</option>
                <option value="Cast">Cast</option>
              </select>
            </label>
          </section>

          <section className={styles.configCard}>
            <h4>TTS / Cloning Engine</h4>
            <div className={styles.engineGrid}>
              {(['edge_tts', 'cosyvoice', 'mimo_tts', 'voxcpm'] as SegmentEngineParams['engine'][]).map(engine => (
                <label key={engine} className={`${styles.engineCard} ${draft.default_engine === engine ? styles.engineCardActive : ''}`}>
                  <input type="radio" name="voice-role-engine" checked={draft.default_engine === engine} onChange={() => setEngine(engine)} />
                  <strong>{({ edge_tts: 'Edge-TTS', cosyvoice: 'CosyVoice', mimo_tts: 'MiMo', voxcpm: 'VoxCPM' } as Record<string, string>)[engine]}</strong>
                  <span>{engine === 'edge_tts' ? '快速迭代' : engine === 'cosyvoice' ? '克隆音色' : engine === 'mimo_tts' ? '预设/克隆' : '本地模型'}</span>
                </label>
              ))}
            </div>
          </section>

          <section className={styles.configCard}>
            <h4>Voice Binding & Tuning</h4>
            {draft.default_engine === 'edge_tts' && (
              <>
                <label>Edge voice
                  <input value={params.edge_voice ?? ''} onChange={(event) => setParams({ edge_voice: event.target.value })} />
                </label>
                <div className={styles.paramRow}>
                  <label>语速<input value={params.edge_rate ?? '+0%'} onChange={(event) => setParams({ edge_rate: event.target.value })} /></label>
                  <label>音量<input value={params.edge_volume ?? '+0%'} onChange={(event) => setParams({ edge_volume: event.target.value })} /></label>
                </div>
              </>
            )}
            {draft.default_engine === 'cosyvoice' && (
              <>
                <label>CosyVoice voice id
                  <input value={params.voice_id ?? ''} onChange={(event) => setParams({ voice_id: event.target.value })} />
                </label>
                <div className={styles.paramRow}>
                  <label>语速<input type="number" step="0.01" value={params.speed ?? 1} onChange={(event) => setParams({ speed: Number(event.target.value) })} /></label>
                  <label>音量<input type="number" value={params.volume ?? 80} onChange={(event) => setParams({ volume: Number(event.target.value) })} /></label>
                  <label>音高<input type="number" step="0.01" value={params.pitch ?? 1} onChange={(event) => setParams({ pitch: Number(event.target.value) })} /></label>
                </div>
                <label>风格指令
                  <textarea value={params.instruction ?? ''} onChange={(event) => setParams({ instruction: event.target.value })} />
                </label>
              </>
            )}
            {draft.default_engine === 'mimo_tts' && (
              <>
                <label>MiMo 模式
                  <select value={params.mimo_mode ?? 'preset'} onChange={(event) => setParams({ mimo_mode: event.target.value as 'preset' | 'voiceclone' })}>
                    <option value="preset">Preset</option>
                    <option value="voiceclone">Voice Clone</option>
                  </select>
                </label>
                <label>MiMo preset voice<input value={params.mimo_preset_voice ?? ''} onChange={(event) => setParams({ mimo_preset_voice: event.target.value })} /></label>
                <label>MiMo clone voice id<input value={params.mimo_clone_voice_id ?? ''} onChange={(event) => setParams({ mimo_clone_voice_id: event.target.value })} /></label>
                <label>MiMo instruction<textarea value={params.mimo_instruction ?? ''} onChange={(event) => setParams({ mimo_instruction: event.target.value })} /></label>
              </>
            )}
            {draft.default_engine === 'voxcpm' && (
              <>
                <label>VoxCPM mode
                  <select value={params.voxcpm_mode ?? 'tts'} onChange={(event) => setParams({ voxcpm_mode: event.target.value as NonNullable<SegmentEngineParams['voxcpm_mode']> })}>
                    <option value="tts">TTS</option>
                    <option value="design">Design</option>
                    <option value="clone">Clone</option>
                    <option value="ultimate">Ultimate</option>
                  </select>
                </label>
                <label>VoxCPM voice id<input value={params.voice_id ?? ''} onChange={(event) => setParams({ voice_id: event.target.value })} /></label>
                <label>Voice description<textarea value={params.voxcpm_voice_description ?? ''} onChange={(event) => setParams({ voxcpm_voice_description: event.target.value })} /></label>
                <label>Style control<textarea value={params.voxcpm_style_control ?? ''} onChange={(event) => setParams({ voxcpm_style_control: event.target.value })} /></label>
              </>
            )}
          </section>
        </div>

        <aside className={styles.previewCard}>
          <span className={styles.kicker}>Real-time Preview</span>
          <h4>Studio Playback</h4>
          <p>“这是一段角色试听文本，用来确认音色、节奏和情绪是否适合当前项目。”</p>
          <div className={styles.waveform} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
          <button type="button" className={styles.ghostButton}>生成试听</button>
        </aside>
      </div>
    </section>
  );
}

export function ProjectVoices({
  roles,
  defaultNarratorRoleId,
  onSetDefaultNarrator,
  onCreateDefaultNarrator,
  onCreateCast,
  onSaveRole,
  onPreviewRole,
  onManageRoles,
  defaultNarratorPreviewLabel = `Edge-TTS · ${DEFAULT_EDGE_NARRATOR_VOICE}`,
}: ProjectVoicesProps) {
  const [editingRole, setEditingRole] = useState<RoleSnapshot | null>(null);
  const narratorRoles = roles.filter(role => isNarratorRole(role, defaultNarratorRoleId));
  const castRoles = roles.filter(role => !isNarratorRole(role, defaultNarratorRoleId));
  const defaultNarrator = defaultNarratorRoleId
    ? roles.find(role => role.id === defaultNarratorRoleId) ?? null
    : null;
  const saveEditingRole = (draft: RoleSnapshot) => {
    onSaveRole?.(draft);
    setEditingRole(null);
  };

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
            <button type="button" className={styles.primaryButton} onClick={() => setEditingRole(createRoleDraft('Narrator'))}>创建默认旁白</button>
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
              <div className={styles.roleActions}>
                <button type="button" onClick={() => onPreviewRole(defaultNarrator, NARRATOR_SAMPLE)}>试听</button>
                <button type="button" aria-label={`编辑 ${defaultNarrator.name}`} onClick={() => setEditingRole(roleToSnapshot(defaultNarrator))}>编辑</button>
              </div>
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
            <button type="button" className={styles.primaryButton} onClick={() => setEditingRole(createRoleDraft('Cast'))}>新增 Cast</button>
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
                <div className={styles.roleActions}>
                  <button type="button" onClick={() => onPreviewRole(role, CAST_SAMPLE)}>试听</button>
                  <button type="button" aria-label={`编辑 ${role.name}`} onClick={() => setEditingRole(roleToSnapshot(role))}>编辑</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {editingRole && (
        <VoiceRoleEditor
          draft={editingRole}
          onChange={setEditingRole}
          onCancel={() => setEditingRole(null)}
          onSave={saveEditingRole}
        />
      )}
    </section>
  );
}
