import { useEffect, useState } from 'react';
import type { Role, RoleSnapshot, SegmentEngineParams, VoiceProfile } from '../../types';
import { ttsApi } from '../../services/api';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import { DEFAULT_EDGE_CAST_VOICE, DEFAULT_EDGE_NARRATOR_VOICE } from '../../services/voiceRoleDefaults';
import { isNarratorRole } from '../../services/voiceRoleKind';
import { StyleInstructionPicker } from '../TTSSynthesis/StyleInstructionPicker';
import styles from './ProjectVoices.module.css';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ProjectVoicesProps {
  roles: Role[];
  defaultNarratorRoleId?: string | null;
  onSetDefaultNarrator: (roleId: string | null, roleSnapshot: RoleSnapshot | null) => void;
  onCreateDefaultNarrator?: () => void;
  onCreateCast?: () => void;
  onSaveRole?: (role: RoleSnapshot) => void;
  onDeleteRole?: (roleId: string) => void;
  onPreviewRole: (role: RoleSnapshot, sampleText: string) => void;
  onManageRoles: () => void;
  defaultNarratorPreviewLabel?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const NARRATOR_SAMPLE = '这是一段默认旁白试听，用于确认叙述声音是否沉稳、清晰，并适合长时间解说。';
const CAST_SAMPLE = '你好，我是这个角色的声音。请确认语气、节奏和音色是否符合当前场景。';
const MIMO_PRESET_VOICES = ['冰糖', '星辰', '雪梨', '琥珀', '青云', '紫霞'];
const COMMON_EDGE_VOICES = [
  { short_name: DEFAULT_EDGE_NARRATOR_VOICE, display_name: 'Yunxi', gender: 'Male' },
  { short_name: DEFAULT_EDGE_CAST_VOICE, display_name: 'Yunyang', gender: 'Male' },
  { short_name: 'zh-CN-XiaoxiaoNeural', display_name: 'Xiaoxiao', gender: 'Female' },
];

type EngineKey = 'edge_tts' | 'cosyvoice' | 'mimo_tts' | 'voxcpm';

const ENGINE_META: Record<EngineKey, { label: string; avatarClass: string }> = {
  edge_tts: { label: 'Edge-TTS', avatarClass: styles.avatarEdge },
  cosyvoice: { label: 'CosyVoice', avatarClass: styles.avatarCosy },
  mimo_tts: { label: 'MiMo', avatarClass: styles.avatarMimo },
  voxcpm: { label: 'VoxCPM', avatarClass: styles.avatarVoxcpm },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

function engineLabel(role: Role): string {
  return ENGINE_META[role.default_engine as EngineKey]?.label ?? role.default_engine;
}

function avatarClass(engine: string): string {
  return ENGINE_META[engine as EngineKey]?.avatarClass ?? styles.avatarDefault;
}

function isConfigured(role: Role): boolean {
  return !!(role.default_voice || role.default_engine_params.edge_voice || role.default_engine_params.voice_id || role.default_engine_params.mimo_preset_voice);
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

/* ------------------------------------------------------------------ */
/*  VoiceRoleEditor (inline)                                           */
/* ------------------------------------------------------------------ */

function VoiceRoleEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  onPreview,
}: {
  draft: RoleSnapshot;
  onChange: (draft: RoleSnapshot) => void;
  onCancel: () => void;
  onSave: (draft: RoleSnapshot) => void;
  onPreview: (draft: RoleSnapshot, sampleText: string) => void;
}) {
  const params = draft.default_engine_params;
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [edgeVoices, setEdgeVoices] = useState<{ short_name: string; display_name: string; gender: string }[]>(COMMON_EDGE_VOICES);
  const { refreshCounter } = useVoiceRefresh();

  useEffect(() => {
    ttsApi.getVoices().then(setVoices).catch(() => {});
  }, [refreshCounter]);

  useEffect(() => {
    ttsApi.getEdgeVoices('Chinese').then(setEdgeVoices).catch(() => {});
  }, []);

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

  const engineOptions: { id: EngineKey; label: string }[] = [
    { id: 'cosyvoice', label: 'CosyVoice' },
    { id: 'edge_tts', label: 'Edge-TTS' },
    { id: 'mimo_tts', label: 'MiMo' },
    { id: 'voxcpm', label: 'VoxCPM' },
  ];

  return (
    <section className={styles.editorPanel} aria-label="声音角色编辑器">
      <div className={styles.editorBar}>
        <div>
          <span className={styles.kicker}>Voice Role</span>
          <h3>{draft.name || '声音角色配置'}</h3>
          <p>{draft.description === 'Narrator' ? '默认旁白声音' : 'Cast 对话角色'} · 选择模型、音色和参数。</p>
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
            <h4>角色声音参数</h4>
            <p className={styles.configHint}>参数覆盖 — 修改后用于该角色的新合成。布局与工作室参数面板保持一致。</p>
            <div className={styles.engineRow}>
              <span className={styles.paramLabel}>模型</span>
              <div className={styles.enginePills}>
                {engineOptions.map(engine => (
                  <button
                    type="button"
                    key={engine.id}
                    role="radio"
                    aria-checked={draft.default_engine === engine.id}
                    className={`${styles.enginePill} ${draft.default_engine === engine.id ? styles.enginePillActive : ''}`}
                    onClick={() => setEngine(engine.id)}
                  >
                    {engine.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.paramsGrid}>
              {draft.default_engine === 'edge_tts' && (
                <>
                  <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>音色
                    <select className={styles.paramSelect} value={params.edge_voice ?? ''} onChange={(event) => setParams({ edge_voice: event.target.value })}>
                      {params.edge_voice && <option value={params.edge_voice}>{params.edge_voice}</option>}
                      {edgeVoices.map(voice => (
                        <option key={voice.short_name} value={voice.short_name}>
                          {voice.display_name} ({voice.gender === 'Female' ? '女' : '男'})
                        </option>
                      ))}
                      {!params.edge_voice && edgeVoices.length === 0 && <option value="">请选择 Edge 音色</option>}
                    </select>
                  </label>
                  <label className={styles.paramField}>语速
                    <input className={styles.paramInput} value={params.edge_rate ?? '+0%'} onChange={(event) => setParams({ edge_rate: event.target.value })} />
                  </label>
                  <label className={styles.paramField}>音量
                    <input className={styles.paramInput} value={params.edge_volume ?? '+0%'} onChange={(event) => setParams({ edge_volume: event.target.value })} />
                  </label>
                </>
              )}
              {draft.default_engine === 'cosyvoice' && (
                <>
                  <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>CosyVoice voice id
                    <input className={styles.paramInput} list="project-cosy-voices" value={params.voice_id ?? ''} onChange={(event) => setParams({ voice_id: event.target.value })} />
                    <datalist id="project-cosy-voices">
                      {voices.map(voice => {
                        const key = voice.qwen_voice_id || voice.id;
                        return <option key={voice.id} value={key}>{voice.description || voice.name}</option>;
                      })}
                    </datalist>
                  </label>
                  <label className={styles.paramField}>语速
                    <input className={styles.range} aria-label="语速" type="range" min={0.5} max={2} step={0.01} value={params.speed ?? 1} onChange={(event) => setParams({ speed: Number(event.target.value) })} />
                    <span className={styles.sliderVal}>{(params.speed ?? 1).toFixed(2)}×</span>
                  </label>
                  <label className={styles.paramField}>音量
                    <input className={styles.range} aria-label="音量" type="range" min={0} max={100} value={params.volume ?? 80} onChange={(event) => setParams({ volume: Number(event.target.value) })} />
                    <span className={styles.sliderVal}>{params.volume ?? 80}</span>
                  </label>
                  <label className={styles.paramField}>音高
                    <input className={styles.range} aria-label="音高" type="range" min={0.5} max={2} step={0.01} value={params.pitch ?? 1} onChange={(event) => setParams({ pitch: Number(event.target.value) })} />
                    <span className={styles.sliderVal}>{(params.pitch ?? 1).toFixed(2)}</span>
                  </label>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <StyleInstructionPicker value={params.instruction ?? ''} onChange={(value) => setParams({ instruction: value })} label="风格指令" placeholder="跟随全局风格指令，或选择预设/直接输入..." dense />
                  </div>
                </>
              )}
              {draft.default_engine === 'mimo_tts' && (
                <>
                  <label className={styles.paramField}>MiMo 模式
                    <select className={styles.paramSelect} value={params.mimo_mode ?? 'preset'} onChange={(event) => setParams({ mimo_mode: event.target.value as 'preset' | 'voiceclone' })}>
                      <option value="preset">Preset</option>
                      <option value="voiceclone">Voice Clone</option>
                    </select>
                  </label>
                  <label className={styles.paramField}>MiMo preset voice
                    <select className={styles.paramSelect} value={params.mimo_preset_voice ?? ''} onChange={(event) => setParams({ mimo_preset_voice: event.target.value })}>
                      {MIMO_PRESET_VOICES.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                  <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>MiMo clone voice id
                    <input className={styles.paramInput} value={params.mimo_clone_voice_id ?? ''} onChange={(event) => setParams({ mimo_clone_voice_id: event.target.value })} />
                  </label>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <StyleInstructionPicker value={params.mimo_instruction ?? ''} onChange={(value) => setParams({ mimo_instruction: value })} label="风格指令" placeholder="跟随全局风格指令，或选择预设/直接输入..." dense />
                  </div>
                </>
              )}
              {draft.default_engine === 'voxcpm' && (
                <>
                  <label className={styles.paramField}>VoxCPM mode
                    <select className={styles.paramSelect} value={params.voxcpm_mode ?? 'tts'} onChange={(event) => setParams({ voxcpm_mode: event.target.value as NonNullable<SegmentEngineParams['voxcpm_mode']> })}>
                      <option value="tts">TTS</option>
                      <option value="design">Design</option>
                      <option value="clone">Clone</option>
                      <option value="ultimate">Ultimate</option>
                    </select>
                  </label>
                  <label className={styles.paramField}>VoxCPM voice id
                    <input className={styles.paramInput} list="project-voxcpm-voices" value={params.voice_id ?? ''} onChange={(event) => setParams({ voice_id: event.target.value })} />
                    <datalist id="project-voxcpm-voices">
                      {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.description || voice.name}</option>)}
                    </datalist>
                  </label>
                  <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>Voice description<textarea value={params.voxcpm_voice_description ?? ''} onChange={(event) => setParams({ voxcpm_voice_description: event.target.value })} /></label>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <StyleInstructionPicker value={params.voxcpm_style_control ?? ''} onChange={(value) => setParams({ voxcpm_style_control: value })} label="风格指令" placeholder="跟随全局风格指令，或选择预设/直接输入..." dense />
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <aside className={styles.previewCard}>
          <span className={styles.kicker}>Real-time Preview</span>
          <h4>Studio Playback</h4>
          <p>"这是一段角色试听文本，用来确认音色、节奏和情绪是否适合当前项目。"</p>
          <div className={styles.waveform} aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <button type="button" className={styles.ghostButton} onClick={() => onPreview(normalizeDraftForSave(draft), '这是一段角色试听文本，用来确认音色、节奏和情绪是否适合当前项目。')}>生成试听</button>
        </aside>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  CharacterCard                                                      */
/* ------------------------------------------------------------------ */

function CharacterCard({
  role,
  isDefault,
  kind,
  onEdit,
  onPreview,
  onDelete,
}: {
  role: Role;
  isDefault: boolean;
  kind: 'narrator' | 'cast';
  onEdit: () => void;
  onPreview: () => void;
  onDelete?: () => void;
}) {
  const configured = isConfigured(role);
  const cardClass = [
    styles.charCard,
    isDefault ? styles.charCardDefault : '',
    kind === 'narrator' ? styles.charCardNarrator : '',
  ].filter(Boolean).join(' ');

  return (
    <article
      className={cardClass}
      tabIndex={0}
      role="button"
      aria-label={`编辑 ${role.name}`}
      onClick={onEdit}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } }}
    >
      <div className={`${styles.avatar} ${avatarClass(role.default_engine)}`}>
        {role.name.slice(0, 1)}
      </div>

      <div className={styles.cardBody}>
        <strong className={styles.charName}>
          {role.name}
          {isDefault && <span className={styles.defaultBadge}>默认</span>}
        </strong>
        <div className={styles.chipRow}>
          <span className={`${styles.chip} ${kind === 'narrator' ? styles.chipNarrator : styles.chipCast}`}>
            {kind === 'narrator' ? '旁白' : '角色'}
          </span>
          <span className={`${styles.chip} ${styles.chipEngine}`}>{engineLabel(role)}</span>
          <span className={`${styles.chip} ${styles.chipEngine}`}>{role.default_voice || '未设置'}</span>
          <span className={styles.chip} title={configured ? '已配置音色' : '待配置'}>
            <span className={`${styles.statusDot} ${configured ? styles.statusReady : styles.statusDraft}`} />
          </span>
        </div>
      </div>

      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
        >试听</button>
        {onDelete && (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`删除 ${role.name}`}
            title="删除角色"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >✕</button>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  ProjectVoices (main export)                                        */
/* ------------------------------------------------------------------ */

type EngineFilter = 'all' | EngineKey;

export function ProjectVoices({
  roles,
  defaultNarratorRoleId,
  onSaveRole,
  onDeleteRole,
  onPreviewRole,
  onManageRoles,
}: ProjectVoicesProps) {
  const [editingRole, setEditingRole] = useState<RoleSnapshot | null>(null);
  const [engineFilter, setEngineFilter] = useState<EngineFilter>('all');

  const filterByEngine = (list: Role[]) =>
    engineFilter === 'all' ? list : list.filter(r => r.default_engine === engineFilter);

  const narratorRoles = filterByEngine(roles.filter(r => isNarratorRole(r, defaultNarratorRoleId)));
  const castRoles = filterByEngine(roles.filter(r => !isNarratorRole(r, defaultNarratorRoleId)));

  const saveEditingRole = (draft: RoleSnapshot) => {
    onSaveRole?.(draft);
    setEditingRole(null);
  };

  return (
    <section className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.kicker}>Characters</span>
          <h2>角色管理</h2>
          <p className={styles.headerDesc}>管理项目中的旁白与对话角色，配置音色、引擎和参数。</p>
        </div>
        <div className={styles.filterBar}>
          <select
            className={styles.filterSelect}
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value as EngineFilter)}
          >
            <option value="all">全部引擎</option>
            <option value="edge_tts">Edge-TTS</option>
            <option value="cosyvoice">CosyVoice</option>
            <option value="mimo_tts">MiMo</option>
            <option value="voxcpm">VoxCPM</option>
          </select>
          <button type="button" className={styles.ghostButton} onClick={onManageRoles}>角色库</button>
        </div>
      </header>

      {/* Editor (expanded when editing) */}
      {editingRole && (
        <VoiceRoleEditor
          draft={editingRole}
          onChange={setEditingRole}
          onCancel={() => setEditingRole(null)}
          onSave={saveEditingRole}
          onPreview={onPreviewRole}
        />
      )}

      {/* Narrator Group */}
      <section className={styles.roleGroup}>
        <div className={styles.roleGroupHeader}>
          <span className={styles.kicker}>Narrator</span>
          <h3>旁白</h3>
        </div>
        <div className={styles.cardGrid} data-testid="narrator-list">
          {narratorRoles.length === 0 && (
            <div className={styles.emptyState}>
              <strong>还没有旁白角色</strong>
              <p>创建一个旁白角色，用于所有叙述段落。</p>
            </div>
          )}
          {narratorRoles.map(role => (
            <CharacterCard
              key={role.id}
              role={role}
              isDefault={role.id === defaultNarratorRoleId}
              kind="narrator"
              onEdit={() => setEditingRole(roleToSnapshot(role))}
              onPreview={() => onPreviewRole(roleToSnapshot(role), NARRATOR_SAMPLE)}
              onDelete={narratorRoles.length > 1 ? () => onDeleteRole?.(role.id) : undefined}
            />
          ))}
          <button
            type="button"
            className={styles.placeholderCard}
            onClick={() => setEditingRole(createRoleDraft('Narrator'))}
          >
            <span className={styles.placeholderIcon}>+</span>
            <span className={styles.placeholderLabel}>新增旁白</span>
          </button>
        </div>
      </section>

      {/* Cast Group */}
      <section className={styles.roleGroup}>
        <div className={styles.roleGroupHeader}>
          <span className={styles.kicker}>Cast</span>
          <h3>角色</h3>
        </div>
        <div className={styles.cardGrid} data-testid="cast-list">
          {castRoles.length === 0 && (
            <div className={styles.emptyState}>
              <strong>还没有对话角色</strong>
              <p>创建对话/剧本角色，用于台词段落。</p>
            </div>
          )}
          {castRoles.map(role => (
            <CharacterCard
              key={role.id}
              role={role}
              isDefault={false}
              kind="cast"
              onEdit={() => setEditingRole(roleToSnapshot(role))}
              onPreview={() => onPreviewRole(roleToSnapshot(role), CAST_SAMPLE)}
              onDelete={() => onDeleteRole?.(role.id)}
            />
          ))}
          <button
            type="button"
            className={styles.placeholderCard}
            onClick={() => setEditingRole(createRoleDraft('Cast'))}
          >
            <span className={styles.placeholderIcon}>+</span>
            <span className={styles.placeholderLabel}>新增角色</span>
          </button>
        </div>
      </section>
    </section>
  );
}
