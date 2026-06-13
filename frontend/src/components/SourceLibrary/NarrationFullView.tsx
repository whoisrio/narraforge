import type { NarrationDocument } from '../../types';
import styles from './NarrationFullView.module.css';

interface NarrationFullViewProps {
  narration: NarrationDocument;
  onClose: () => void;
}

export function NarrationFullView({ narration, onClose }: NarrationFullViewProps) {
  // Parse markdown H2 to render chapters
  const body = narration.body_markdown;
  const h2Pattern = /^## (.+)$/gm;
  const chapters: { title: string; content: string }[] = [];
  let lastIdx = 0;
  let match;
  const h1Match = /^# (.+)$/m.exec(body);
  let workingBody = body;
  let docTitle = '';
  if (h1Match) {
    docTitle = h1Match[1];
    workingBody = body.replace(/^# .+\n/, '');
  }
  while ((match = h2Pattern.exec(workingBody)) !== null) {
    if (lastIdx < match.index) {
      const prev = workingBody.slice(lastIdx, match.index).trim();
      if (prev && chapters.length > 0) {
        chapters[chapters.length - 1].content = prev;
      }
    }
    chapters.push({ title: match[1], content: '' });
    lastIdx = h2Pattern.lastIndex;
  }
  if (chapters.length > 0) {
    chapters[chapters.length - 1].content = workingBody.slice(lastIdx).trim();
  } else {
    chapters.push({ title: '全文', content: workingBody.trim() });
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2>📜 旁白文档 {narration.version}</h2>
            <span className={styles.meta}>
              {chapters.length} 章节 · {narration.word_count.toLocaleString()} 字 ·{' '}
              {new Date(narration.generated_at).toLocaleString('zh-CN', { hour12: false })}
            </span>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.actionBtn}
              onClick={() => {
                navigator.clipboard.writeText(narration.body_markdown);
              }}
            >
              📋 复制
            </button>
            <button className={styles.closeBtn} onClick={onClose}>×</button>
          </div>
        </div>

        <div className={styles.body}>
          {docTitle && <h1 className={styles.docTitle}>{docTitle}</h1>}
          {chapters.map((ch, idx) => (
            <div
              key={idx}
              className={`${styles.chapterBlock} ${idx === 0 ? styles.chapterFirst : ''}`}
            >
              <h3 className={styles.chapterTitle}>{ch.title}</h3>
              <div className={styles.chapterContent}>
                {ch.content.split('\n\n').map((para, i) => (
                  <p key={i}>{para.trim()}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
