import type { TranscribeResult } from '../../services/api';
import { Loading } from '../ui/Loading';
import styles from './TranscriptEditor.module.css';

interface TranscriptEditorProps {
  result: TranscribeResult | null;
  processing: boolean;
  error: string | null;
  onContentChange: (content: string) => void;
}

export function TranscriptEditor({ result, processing, error, onContentChange }: TranscriptEditorProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.activeBadge}>
            <span className={styles.pulseDot} />
            Active Stream
          </span>
        </div>
        <div className={styles.headerRight}>
          {result && (
            <>
              <span className={styles.metaBadge}>
                {result.language} ({(result.language_probability * 100).toFixed(1)}%)
              </span>
              {result.device && (
                <span className={`${styles.metaBadge} ${result.device === 'cuda' ? styles.gpuBadge : ''}`}>
                  {result.device === 'cuda' ? 'GPU' : 'CPU'} ({result.compute_type})
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {processing && (
        <div className={styles.processing}>
          <Loading size="lg" />
          <div className={styles.processingText}>正在识别语音，请耐心等待...</div>
        </div>
      )}

      {error && <div className={styles.errorBanner}>{error}</div>}

      {result && !processing ? (
        <textarea
          className={styles.editor}
          aria-label="Transcript Editor"
          value={result.content}
          onChange={(e) => onContentChange(e.target.value)}
        />
      ) : !processing && !error ? (
        <div className={styles.empty}>
          <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: 0.3 }}>mic</span>
          <strong>还没有 Transcript</strong>
          <span>上传音频文件并启动识别，字幕会显示在这里。</span>
        </div>
      ) : null}

      {result && !processing && (
        <div className={styles.footer}>
          <div className={styles.legend}>
            <div className={styles.legendItem}>
              <div className={`${styles.legendDot} ${styles.legendHigh}`} />
              <span>High</span>
            </div>
            <div className={styles.legendItem}>
              <div className={`${styles.legendDot} ${styles.legendMid}`} />
              <span>Mid</span>
            </div>
            <div className={styles.legendItem}>
              <div className={`${styles.legendDot} ${styles.legendLow}`} />
              <span>Low Confidence</span>
            </div>
          </div>
          <span className={styles.wordCount}>
            {result.content.split(/\s+/).filter(Boolean).length} Words Transcribed
          </span>
        </div>
      )}
    </div>
  );
}
