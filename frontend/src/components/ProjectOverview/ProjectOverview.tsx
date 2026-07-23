import { useState, useRef } from 'react';
import type { Chapter, Role } from '../../types';
import { useTranslation } from '../../i18n';
import styles from './ProjectOverview.module.css';

interface ProjectOverviewProps {
  projectName: string;
  chapters: Chapter[];
  activeChapterId?: string;
  remotionPath?: string | null;
  roles?: Role[];
  onEnterLibrary: () => void;
  onEnterStudio: (chapterId?: string) => void;
  onOpenVoices: () => void;
  onOpenSettings?: () => void;
}

type ChapterStatus = 'ready' | 'synthesizing' | 'draft';

const ENGINE_LABELS: Record<string, string> = {
  edge_tts: 'Edge-TTS',
  cosyvoice: 'CosyVoice',
  mimo_tts: 'MiMo',
  voxcpm: 'VoxCPM',
};

function getChapterStatus(chapter: Chapter): ChapterStatus {
  if (chapter.segments.length === 0) return 'draft';
  if (chapter.segments.every(s => s.status === 'ready')) return 'ready';
  if (chapter.segments.some(s => s.status === 'queued' || s.status === 'pending')) return 'synthesizing';
  return 'draft';
}

function formatRelativeTime(isoDate: string | null | undefined, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (!isoDate) return '';
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return t('projectOverview.justNow');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('projectOverview.minutesAgo', { n: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t('projectOverview.hoursAgo', { n: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return t('projectOverview.yesterday');
  return t('projectOverview.daysAgo', { n: diffDay });
}

function formatDuration(totalSec: number): string {
  const safe = Math.max(0, Math.round(totalSec));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function chapterProgress(chapter: Chapter): { generated: number; total: number; percent: number; duration: number } {
  const total = chapter.segments.length;
  const generated = chapter.segments.filter(segment => segment.status === 'ready').length;
  const percent = total === 0 ? 0 : Math.round((generated / total) * 100);
  const duration = chapter.segments.reduce((sum, segment) => sum + (segment.audio.duration_sec ?? 0), 0);
  return { generated, total, percent, duration };
}

function engineLabel(engine: string): string {
  return ENGINE_LABELS[engine] ?? engine;
}

function voiceLabel(role: Role): string {
  const v = role.voice as unknown as Record<string, unknown>;
  const params = (v?.params ?? {}) as Record<string, unknown>;
  const engine = (v?.engine as string) ?? 'edge_tts';
  if (engine === 'edge_tts') return (params.voice as string) || '';
  return (params.voice_id as string) || '';
}

function RolePreviewButton({ role }: { role: Role }) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);

  const handlePreview = async () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    setError(false);
    try {
      const v = role.voice as unknown as Record<string, unknown>;
      const engine = (v?.engine as string) ?? 'edge_tts';
      let voiceId = '';
      if (engine === 'cosyvoice' || engine === 'mimo_tts' || engine === 'voxcpm') {
        voiceId = (v as { voice_id?: string }).voice_id ?? '';
      }

      let audioSrc: string | null = null;

      // 1) Try to play existing voice profile preview audio
      if (voiceId) {
        try {
          const { ttsApi } = await import('../../services/api');
          const profiles = await ttsApi.getVoices({ voice_id: voiceId });
          const profile = profiles[0];
          if (profile?.has_preview) {
            audioSrc = `/api/clone/audio/${profile.id}?field=preview`;
          }
        } catch { /* fall through to synthesis */ }
      }

      // 2) Fall back to real-time TTS synthesis
      if (!audioSrc) {
        const { ttsApi } = await import('../../services/api');
        const text = t('voiceDesign.defaultSampleText') || '这是一段试听文本。';
        let resp: { audio_base64: string; audio_format: string };
        if (engine === 'edge_tts') {
          const params = (v as { voice?: string; rate?: string; volume?: string }) || {};
          resp = await ttsApi.synthesize({
            text, engine: 'edge_tts', voice_id: '',
            edge_voice: params.voice || '',
            edge_rate: params.rate || '+0%',
            edge_volume: params.volume || '+0%',
            format: 'mp3',
            // TTSResult 的 audio_base64/audio_format 为可选；此处理路径假定后端必返回（与原有声明一致）
          }) as { audio_base64: string; audio_format: string };
        } else {
          const params = (v as { voice_id?: string; speed?: number; volume?: number; pitch?: number }) || {};
          resp = await ttsApi.synthesize({
            text, engine: engine as 'cosyvoice', voice_id: params.voice_id || '',
            speed: params.speed ?? 1, volume: params.volume ?? 80,
            pitch: params.pitch ?? 1, format: 'mp3',
          }) as { audio_base64: string; audio_format: string };
        }
        const bytes = atob(resp.audio_base64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: resp.audio_format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
        audioSrc = URL.createObjectURL(blob);
      }

      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.addEventListener('ended', () => setPlaying(false));
        audioRef.current.addEventListener('error', () => { setPlaying(false); setError(true); });
      }
      audioRef.current.src = audioSrc;
      await audioRef.current.play();
      setPlaying(true);
    } catch {
      setError(true);
    }
  };

  return (
    <button
      type="button"
      className={styles.rolePreviewBtn}
      onClick={(e) => { e.stopPropagation(); handlePreview(); }}
      title={playing ? t('segment.segmentRow.pause') : t('segment.segmentRow.play')}
      disabled={error}
    >
      {error ? '⚠' : playing ? '⏸' : '▶'}
    </button>
  );
}

export function ProjectOverview(props: ProjectOverviewProps) {
  const { t } = useTranslation();
  const {
    chapters,
    activeChapterId,
    remotionPath,
    roles = [],
    onEnterLibrary,
    onEnterStudio,
    onOpenVoices,
  } = props;
  const segmentCount = chapters.reduce((sum, ch) => sum + ch.segments.length, 0);
  const generatedCount = chapters.reduce(
    (sum, ch) => sum + ch.segments.filter(s => s.status === 'ready').length,
    0,
  );
  const progress = segmentCount === 0 ? 0 : Math.round((generatedCount / segmentCount) * 100);

  const statusLabel = (status: ChapterStatus): string => {
    if (status === 'ready') return t('projectOverview.statusComplete');
    if (status === 'synthesizing') return t('projectOverview.statusSynthesizing');
    return t('projectOverview.statusDraft');
  };

  return (
    <section className={styles.root}>
      {/* Production Progress */}
      <section className={styles.progressCard}>
        <div className={styles.progressHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>◈</span>
            <span>{t('projectOverview.productionProgress')}</span>
          </div>
          <span className={styles.progressPercent}>{progress}%</span>
        </div>
        <div className={styles.progressBar}>
          <i style={{ width: `${progress}%` }} />
        </div>
      </section>

      {/* Manuscript + Cast row */}
      <div className={styles.bentoRow}>
        {/* Manuscript Quick Access */}
        <section className={styles.manuscriptCard}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              <span className={styles.sectionIcon}>▤</span>
              <span>{t('projectOverview.manuscriptQuickAccess')}</span>
            </div>
            <button type="button" className={styles.linkButton} onClick={onEnterLibrary}>
              {t('projectOverview.viewAllChapters')}
            </button>
          </div>
          {chapters.length === 0 ? (
            <p className={styles.emptyHint}>{t('projectOverview.noChaptersYet')}</p>
          ) : (
            <ul className={styles.chapterList} data-visual="compact-chapter-list">
              {chapters.map((chapter, index) => {
                const status = getChapterStatus(chapter);
                const chapterStats = chapterProgress(chapter);
                return (
                  <li
                    key={chapter.id}
                    className={`${styles.chapterListItem} ${styles.chapterClickable} ${chapter.id === activeChapterId ? styles.chapterListItemActive : ''}`}
                    data-chapter-card="compact"
                    aria-label={chapter.design_title || chapter.name}
                    onClick={() => onEnterStudio(chapter.id)}
                  >
                    <span className={styles.chapterIndex}>{String(index + 1).padStart(2, '0')}</span>
                    <div className={styles.chapterInfo}>
                      <strong>{chapter.design_title || chapter.name}</strong>
                      <small>
                        {chapterStats.total} {t('projectOverview.segments')} · {chapterStats.generated} {t('projectOverview.generated')} · {formatDuration(chapterStats.duration)} · {formatRelativeTime(chapter.updated_at || chapter.created_at, t)}
                      </small>
                      <div className={styles.chapterProgressTrack} aria-hidden="true">
                        <i style={{ width: `${chapterStats.percent}%` }} />
                      </div>
                    </div>
                    <span
                      className={
                        status === 'ready'
                          ? styles.statusReady
                          : status === 'synthesizing'
                            ? styles.statusSynthesizing
                            : styles.statusDraft
                      }
                    >
                      {statusLabel(status)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Active Cast */}
        <section className={styles.castCard}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              <span className={styles.sectionIcon}>◌</span>
              <span>{t('projectOverview.activeCast')}</span>
            </div>
          </div>

          {/* Roles */}
          <div className={styles.castSection}>
            {roles.length === 0 ? (
              <p className={styles.emptyHint}>{t('projectOverview.noRoles')}</p>
            ) : (
              <div className={styles.castList}>
                {roles.map(role => (
                  <div key={role.id} className={styles.castMember}>
                    <div className={styles.castAvatar}>{role.name.slice(0, 1)}</div>
                    <div className={styles.castInfo}>
                      <strong>{role.name}</strong>
                      <small>{engineLabel((role.voice as unknown as Record<string, unknown>)?.engine as string ?? 'edge_tts')} · {voiceLabel(role)}</small>
                    </div>
                    <RolePreviewButton role={role} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="button" className={styles.assignButton} onClick={onOpenVoices}>
            {t('projectOverview.assignCharacter')}
          </button>
        </section>
      </div>

      {/* Technical Overview */}
      <section className={styles.technicalCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>⚙</span>
            <span>{t('projectOverview.technicalOverview')}</span>
          </div>
        </div>
        <div className={styles.techGrid}>
          <div className={styles.techField}>
            <span className={styles.techLabel}>{t('projectOverview.remotionRepo')}</span>
            <div className={styles.techValue}>
              <code>{remotionPath || t('projectOverview.notConfigured')}</code>
            </div>
          </div>
          <div className={styles.techField}>
            <span className={styles.techLabel}>{t('projectOverview.autoSrt')}</span>
            <div className={styles.techToggleRow}>
              <span className={styles.techToggleLabel}>{t('projectOverview.comingSoon')}</span>
              <label className={styles.toggleDisabled}>
                <input type="checkbox" disabled />
                <span className={styles.toggleTrack}>
                  <span className={styles.toggleThumb} />
                </span>
              </label>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
