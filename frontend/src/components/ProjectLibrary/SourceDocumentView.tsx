import { useCallback, useEffect, useRef } from 'react';
import MDEditor from '@uiw/react-md-editor';
import styles from './SourceDocumentView.module.css';

interface SourceDocumentViewProps {
  content: string;
  onChange: (text: string) => void;
  onCompare: () => void;
}

function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

export function SourceDocumentView({ content, onChange, onCompare }: SourceDocumentViewProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleChange = useCallback((value: string | undefined) => {
    const text = value ?? '';
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(text), 500);
  }, [onChange]);

  return (
    <div className={styles.container} data-color-mode="light">
      <div className={styles.editor}>
        <MDEditor
          value={content}
          onChange={handleChange}
          preview="live"
          height="100%"
          visibleDragbar={false}
          hideToolbar={false}
        />
      </div>
      <div className={styles.bottomBar}>
        <button type="button" className={styles.ghostButton} onClick={onCompare}>
          对比查看
        </button>
        <div className={styles.stats}>
          <span>{countChars(content)} 字</span>
        </div>
      </div>
    </div>
  );
}
