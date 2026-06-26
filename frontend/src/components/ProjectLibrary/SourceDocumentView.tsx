import { useCallback, useEffect, useRef, useState } from 'react';
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

function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

export function SourceDocumentView({ content, onChange, onCompare, onBack, viewMode, onViewModeChange }: SourceDocumentViewProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    clearTimeout(timerRef.current);
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
