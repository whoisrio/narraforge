import { useTranslation } from '../../i18n';
import styles from './StoryboardPanel.module.css';

interface StoryboardSpec {
  start_sec?: number;
  end_sec?: number;
  narration_text?: string;
  visual_content?: { type?: string; description?: string; source_ref?: string | null };
  animation?: { effect?: string; notes?: string };
}

interface StoryboardSegment {
  id: string;
  position?: number;
  text?: string;
  animation_spec?: StoryboardSpec | null;
}

interface StoryboardChapter {
  id: string;
  name: string;
  segments: StoryboardSegment[];
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  code: 'storyboard.typeCode',
  image: 'storyboard.typeImage',
  key_points: 'storyboard.typePoints',
  text: 'storyboard.typeText',
};

function fmt(sec?: number): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function StoryboardPanel({ chapters }: { chapters: StoryboardChapter[] }) {
  const { t } = useTranslation();
  const withBrief = chapters
    .map((ch) => ({ ...ch, segments: ch.segments.filter((s) => s.animation_spec) }))
    .filter((ch) => ch.segments.length > 0);

  const copyAsText = () => {
    const lines: string[] = [];
    for (const ch of withBrief) {
      lines.push(`# ${ch.name}`);
      for (const seg of ch.segments) {
        const spec = seg.animation_spec!;
        lines.push(`[${fmt(spec.start_sec)}-${fmt(spec.end_sec)}] ${spec.narration_text || seg.text || ''}`);
        lines.push(`  ${t('storyboard.visualLabel')}: ${spec.visual_content?.type ?? 'text'} - ${spec.visual_content?.description ?? ''}`);
        lines.push(`  ${t('storyboard.animationLabel')}: ${spec.animation?.effect ?? ''}${spec.animation?.notes ? ` (${spec.animation.notes})` : ''}`);
      }
    }
    void navigator.clipboard.writeText(lines.join('\n'));
  };

  if (!withBrief.length) {
    return (
      <div className={styles.empty}>
        {t('storyboard.empty')}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.copyBtn} onClick={copyAsText}>
          <span className="material-symbols-outlined">content_copy</span>
          {t('storyboard.copyAsText')}
        </button>
      </div>
      {withBrief.map((ch) => (
        <section key={ch.id} className={styles.chapter}>
          <h3 className={styles.chapterTitle}>{ch.name}</h3>
          {ch.segments.map((seg) => {
            const spec = seg.animation_spec!;
            return (
              <div key={seg.id} className={styles.storyboardCard}>
                <div className={styles.timeRange}>
                  {fmt(spec.start_sec)} – {fmt(spec.end_sec)}
                </div>
                <p className={styles.narration}>{spec.narration_text || seg.text}</p>
                <div className={styles.visual}>
                  <span className={styles.visualType}>
                    {TYPE_LABEL_KEYS[spec.visual_content?.type ?? 'text'] ? t(TYPE_LABEL_KEYS[spec.visual_content?.type ?? 'text']) : spec.visual_content?.type}
                  </span>
                  <span>{spec.visual_content?.description}</span>
                </div>
                <div className={styles.effect}>
                  <span className="material-symbols-outlined">animation</span>
                  {spec.animation?.effect}
                  {spec.animation?.notes ? ` · ${spec.animation.notes}` : ''}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
