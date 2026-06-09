import { useRef, useEffect } from 'react';
import styles from './CollapsiblePanel.module.css';

interface CollapsiblePanelProps {
  /** Header title — typically the engine name */
  title: string;
  /** Brief summary shown next to title (e.g. current voice name) */
  summary?: string;
  /** Whether the panel is open */
  open: boolean;
  /** Toggle callback */
  onToggle: () => void;
  children: React.ReactNode;
}

export function CollapsiblePanel({
  title, summary, open, onToggle, children,
}: CollapsiblePanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Dynamically set max-height for smooth transition
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (open) {
      el.style.maxHeight = el.scrollHeight + 'px';
      // After transition, allow content to grow naturally (e.g. async loaded items)
      const onEnd = () => { el.style.maxHeight = 'none'; el.removeEventListener('transitionend', onEnd); };
      el.addEventListener('transitionend', onEnd);
    } else {
      // First set explicit height so transition has a start value
      el.style.maxHeight = el.scrollHeight + 'px';
      // Force reflow then collapse
      requestAnimationFrame(() => { el.style.maxHeight = '0px'; });
    }
  }, [open]);

  return (
    <div className={styles.panel}>
      <button className={styles.header} onClick={onToggle} aria-expanded={open}>
        <span className={styles.title}>{title}</span>
        {summary && <span className={styles.summary}>{summary}</span>}
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>▶</span>
      </button>
      <div ref={contentRef} className={`${styles.content} ${open ? '' : styles.contentCollapsed}`}>
        {children}
      </div>
    </div>
  );
}
