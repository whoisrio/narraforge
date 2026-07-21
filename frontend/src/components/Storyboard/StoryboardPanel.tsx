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

const TYPE_LABELS: Record<string, string> = {
  code: '代码',
  image: '图片',
  key_points: '要点',
  text: '文字',
};

function fmt(sec?: number): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function StoryboardPanel({ chapters }: { chapters: StoryboardChapter[] }) {
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
        lines.push(`  画面: ${spec.visual_content?.type ?? 'text'} - ${spec.visual_content?.description ?? ''}`);
        lines.push(`  动画: ${spec.animation?.effect ?? ''}${spec.animation?.notes ? ` (${spec.animation.notes})` : ''}`);
      }
    }
    void navigator.clipboard.writeText(lines.join('\n'));
  };

  if (!withBrief.length) {
    return (
      <div className={styles.empty}>
        暂无分镜数据。运行知识视频工作流后，这里会展示每段旁白的动画分镜 brief。
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.copyBtn} onClick={copyAsText}>
          <span className="material-symbols-outlined">content_copy</span>
          复制为文本
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
                    {TYPE_LABELS[spec.visual_content?.type ?? 'text'] ?? spec.visual_content?.type}
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
