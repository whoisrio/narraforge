import { useRef, useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import styles from './ImageUploadZone.module.css';

interface ImageUploadZoneProps {
  value?: string | null;
  onChange: (dataUrl: string | null) => void;
  size?: 'sm' | 'md' | 'lg';
  placeholder?: React.ReactNode;
}

const MAX_SIZE = 2 * 1024 * 1024; // 2MB

const SIZE_MAP = {
  sm: 56,
  md: 80,
  lg: 120,
};

export function ImageUploadZone({ value, onChange, size = 'md', placeholder }: ImageUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  const processFile = useCallback((file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError(t('imageUpload.errorFileType'));
      return;
    }
    if (file.size > MAX_SIZE) {
      setError(t('imageUpload.errorFileSize'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onChange(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, [onChange, t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.currentTarget.value = '';
  }, [processFile]);

  const dimension = SIZE_MAP[size];

  if (value) {
    return (
      <div
        className={`${styles.zone} ${styles.hasImage}`}
        style={{ width: dimension, height: dimension }}
      >
        <img src={value} alt="" className={styles.preview} />
        <button
          type="button"
          className={styles.removeBtn}
          onClick={(e) => { e.stopPropagation(); onChange(null); }}
          aria-label={t('imageUpload.removeImage')}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        className={`${styles.zone} ${dragOver ? styles.dragOver : ''}`}
        style={{ width: dimension, height: dimension }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {placeholder ?? (
          <>
            <span className="material-symbols-outlined" style={{ fontSize: dimension * 0.35, opacity: 0.4 }}>add_photo_alternate</span>
            <span className={styles.hint}>{t('imageUpload.uploadImage')}</span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className={styles.hiddenInput}
        onChange={handleFileInput}
      />
      {error && <span className={styles.error}>{error}</span>}
    </>
  );
}
