import { useCallback, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import styles from './SourceDocumentView.module.css';

interface SourceDocumentViewProps {
  content: string;
  onChange: (text: string) => void;
  onCompare: () => void;
  onBack: () => void;
  viewMode: 'edit' | 'view';
  onViewModeChange: (mode: 'edit' | 'view') => void;
}

export function SourceDocumentView({
  content, onChange, viewMode,
}: SourceDocumentViewProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => clearTimeout(timerRef.current ?? undefined);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    clearTimeout(timerRef.current ?? undefined);
    timerRef.current = setTimeout(() => onChange(text), 500);
  }, [onChange]);

  return (
    <div className={styles.container}>
      {viewMode === 'edit' ? (
        <textarea
          className={styles.editor}
          defaultValue={content}
          onChange={handleChange}
          placeholder="输入源文档内容（支持 Markdown）..."
          spellCheck={false}
        />
      ) : (
        <div className={styles.previewArea}>
          <Markdown>{content || '*（空文档）*'}</Markdown>
        </div>
      )}
    </div>
  );
}
