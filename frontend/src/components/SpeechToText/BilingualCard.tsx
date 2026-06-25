import type { BilingualSegment } from '../../services/api';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import styles from './BilingualCard.module.css';

interface BilingualCardProps {
  bilingualSegments: BilingualSegment[];
  bilingualSrt: string;
  translating: boolean;
  targetLang: string;
  hasResult: boolean;
  onTargetLangChange: (lang: string) => void;
  onTranslate: () => void;
  onDownload: () => void;
}

const LANG_OPTIONS = [
  { value: 'English', label: 'English' },
  { value: 'Japanese', label: '日本語' },
  { value: 'Korean', label: '한국어' },
  { value: 'French', label: 'Français' },
  { value: 'German', label: 'Deutsch' },
  { value: 'Spanish', label: 'Español' },
];

export function BilingualCard({
  bilingualSegments, translating, targetLang, hasResult,
  onTargetLangChange, onTranslate, onDownload,
}: BilingualCardProps) {
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        <span className="material-symbols-outlined">translate</span>
        Bilingual
      </h3>
      <div className={styles.controls}>
        <Select
          label=""
          options={LANG_OPTIONS}
          value={targetLang}
          onChange={(e) => onTargetLangChange(e.target.value)}
        />
        <Button
          variant="secondary"
          size="sm"
          loading={translating}
          disabled={translating || !hasResult}
          onClick={onTranslate}
        >
          {translating ? '翻译中...' : '生成双语'}
        </Button>
      </div>
      {bilingualSegments.length > 0 && (
        <>
          <div className={styles.segmentList}>
            {bilingualSegments.map((seg) => (
              <div key={seg.index} className={styles.segment}>
                <div className={styles.segIndex}>{seg.index}</div>
                <div className={styles.segContent}>
                  <div className={styles.segTime}>{seg.time_line}</div>
                  <div className={styles.segOriginal}>{seg.original}</div>
                  <div className={styles.segTranslated}>{seg.translated}</div>
                </div>
              </div>
            ))}
          </div>
          <Button variant="primary" size="sm" fullWidth onClick={onDownload}>
            下载双语 SRT
          </Button>
        </>
      )}
    </div>
  );
}
