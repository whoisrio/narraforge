import type { Chapter, Role } from '../../types';
import { roleVoiceLabelFromParams } from '../../services/voiceRoleDefaults';
import styles from './ProjectOverview.module.css';

interface ProjectOverviewProps {
  projectName: string;
  chapters: Chapter[];
  activeChapterId?: string;
  remotionPath?: string | null;
  roles?: Role[];
  onEnterLibrary: () => void;
  onEnterStudio: () => void;
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

function chapterStatusLabel(status: ChapterStatus): string {
  if (status === 'ready') return '完成';
  if (status === 'synthesizing') return '合成中';
  return '草稿';
}

function formatRelativeTime(isoDate?: string | null): string {
  if (!isoDate) return '';
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'Yesterday';
  return `${diffDay}d ago`;
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
  const duration = chapter.segments.reduce((sum, segment) => sum + (segment.duration_sec ?? 0), 0);
  return { generated, total, percent, duration };
}

function engineLabel(engine: string): string {
  return ENGINE_LABELS[engine] ?? engine;
}

function voiceLabel(role: Role): string {
  return roleVoiceLabelFromParams(role.default_engine_params, role.default_voice);
}

export function ProjectOverview(props: ProjectOverviewProps) {
  const {
    chapters,
    activeChapterId,
    remotionPath,
    roles = [],
    onEnterLibrary,
    onOpenVoices,
  } = props;
  const segmentCount = chapters.reduce((sum, ch) => sum + ch.segments.length, 0);
  const generatedCount = chapters.reduce(
    (sum, ch) => sum + ch.segments.filter(s => s.status === 'ready').length,
    0,
  );
  const progress = segmentCount === 0 ? 0 : Math.round((generatedCount / segmentCount) * 100);

  return (
    <section className={styles.root}>
      {/* Production Progress */}
      <section className={styles.progressCard}>
        <div className={styles.progressHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>◈</span>
            <span>Production Progress</span>
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
              <span>Manuscript Quick Access</span>
            </div>
            <button type="button" className={styles.linkButton} onClick={onEnterLibrary}>
              View All Chapters
            </button>
          </div>
          {chapters.length === 0 ? (
            <p className={styles.emptyHint}>No chapters yet. Open the text library to get started.</p>
          ) : (
            <ul className={styles.chapterList} data-visual="compact-chapter-list">
              {chapters.map((chapter, index) => {
                const status = getChapterStatus(chapter);
                const chapterStats = chapterProgress(chapter);
                return (
                  <li
                    key={chapter.id}
                    className={`${styles.chapterListItem} ${chapter.id === activeChapterId ? styles.chapterListItemActive : ''}`}
                    data-chapter-card="compact"
                    aria-label={`章节 ${chapter.design_title || chapter.name}`}
                  >
                    <span className={styles.chapterIndex}>{String(index + 1).padStart(2, '0')}</span>
                    <div className={styles.chapterInfo}>
                      <strong>{chapter.design_title || chapter.name}</strong>
                      <small>{chapterStats.total} 段 · {chapterStats.generated} 已生成 · {formatDuration(chapterStats.duration)} · {formatRelativeTime(chapter.updated_at || chapter.created_at)}</small>
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
                      {chapterStatusLabel(status)}
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
              <span>Active Cast</span>
            </div>
          </div>

          {/* Roles */}
          <div className={styles.castSection}>
            {roles.length === 0 ? (
              <p className={styles.emptyHint}>No roles assigned.</p>
            ) : (
              <div className={styles.castList}>
                {roles.map(role => (
                  <div key={role.id} className={styles.castMember}>
                    <div className={styles.castAvatar}>{role.name.slice(0, 1)}</div>
                    <div className={styles.castInfo}>
                      <strong>{role.name}</strong>
                      <small>{engineLabel(role.default_engine)} · {voiceLabel(role)}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="button" className={styles.assignButton} onClick={onOpenVoices}>
            + ASSIGN CHARACTER
          </button>
        </section>
      </div>

      {/* Technical Overview */}
      <section className={styles.technicalCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>⚙</span>
            <span>Technical Overview</span>
          </div>
        </div>
        <div className={styles.techGrid}>
          <div className={styles.techField}>
            <span className={styles.techLabel}>Remotion Repository</span>
            <div className={styles.techValue}>
              <code>{remotionPath || 'Not configured'}</code>
            </div>
          </div>
          <div className={styles.techField}>
            <span className={styles.techLabel}>Auto-SRT Generation</span>
            <div className={styles.techToggleRow}>
              <span className={styles.techToggleLabel}>Coming soon</span>
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
