import { useRef, useState, useCallback } from 'react';
import { Button } from '../ui/Button';
import { useTranslation } from '../../i18n';
import styles from './AudioDropzone.module.css';

interface AudioDropzoneProps {
  files: File[];
  onReplace: (files: File[]) => void;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onTranscribe: () => void;
  processing: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ACCEPT = '.wav,.mp3,.m4a,.mp4,.mov,.webm';

export function AudioDropzone({ files, onReplace, onAdd, onRemove, onMove, onTranscribe, processing }: AudioDropzoneProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const hasFiles = files.length > 0;
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) {
      if (hasFiles) onAdd(dropped);
      else onReplace(dropped);
    }
  }, [hasFiles, onReplace, onAdd]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    if (selected.length > 0) onReplace(selected);
    e.currentTarget.value = '';
  }, [onReplace]);

  const handleAddInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    if (selected.length > 0) onAdd(selected);
    e.currentTarget.value = '';
  }, [onAdd]);

  const handleReplace = useCallback(() => {
    onReplace([]);
    inputRef.current?.click();
  }, [onReplace]);

  if (!hasFiles) {
    return (
      <div
        className={`${styles.dropzone} ${dragOver ? styles.dragOver : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
      >
        <div className={styles.icon}>
          <span className="material-symbols-outlined">upload_file</span>
        </div>
        <h3 className={styles.title}>{t('audioDropzone.dropTitle')}</h3>
        <p className={styles.hint}>{t('audioDropzone.acceptedFormats')}</p>
        <p className={styles.browse}>{t('audioDropzone.browseFiles')}</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className={styles.hiddenInput}
          onChange={handleFileInput}
        />
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${dragOver ? styles.dragOver : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className={styles.fileList}>
        {files.map((file, index) => (
          <div key={`${file.name}-${file.size}-${index}`} className={styles.fileRow}>
            <span className={styles.fileIndex}>{String(index + 1).padStart(2, '0')}</span>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileSize}>{formatSize(file.size)}</span>
            <div className={styles.fileActions}>
              <button
                type="button"
                className={styles.moveBtn}
                onClick={() => onMove(index, -1)}
                disabled={index === 0}
                aria-label={t('audioDropzone.moveUp', { name: file.name })}
              >
                <span className="material-symbols-outlined">arrow_upward</span>
              </button>
              <button
                type="button"
                className={styles.moveBtn}
                onClick={() => onMove(index, 1)}
                disabled={index === files.length - 1}
                aria-label={t('audioDropzone.moveDown', { name: file.name })}
              >
                <span className="material-symbols-outlined">arrow_downward</span>
              </button>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => onRemove(index)}
                aria-label={t('audioDropzone.remove', { name: file.name })}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <div className={styles.total}>
          {t('audioDropzone.totalInfo', { size: formatSize(totalSize), count: files.length })}
        </div>
        <div className={styles.footerActions}>
          <button type="button" className={styles.replaceBtn} onClick={handleReplace}>
            <span className="material-symbols-outlined">refresh</span>
            {t('audioDropzone.replaceFiles')}
          </button>
          <button type="button" className={styles.addBtn} onClick={() => addInputRef.current?.click()}>
            <span className="material-symbols-outlined">add</span>
            {t('audioDropzone.addMore')}
          </button>
        </div>
      </div>

      <div className={styles.transcribeRow}>
        <Button
          variant="primary"
          fullWidth
          loading={processing}
          disabled={files.length === 0 || processing}
          onClick={onTranscribe}
        >
          {processing ? t('audioDropzone.recognizing') : files.length > 1 ? t('audioDropzone.unifiedAsr') : t('audioDropzone.startRecognition')}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className={styles.hiddenInput}
        onChange={handleFileInput}
      />
      <input
        ref={addInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className={styles.hiddenInput}
        onChange={handleAddInput}
      />
    </div>
  );
}
