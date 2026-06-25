import { useState } from 'react';
import type { CorrectionSuggestion } from '../../services/api';
import { computeCharDiff } from '../../hooks/useTranscription';
import { Button } from '../ui/Button';
import styles from './CorrectionPanel.module.css';

interface CorrectionPanelProps {
  suggestions: CorrectionSuggestion[];
  acceptedSuggestions: Set<number>;
  correctionModel: string | null;
  correcting: boolean;
  originalDoc: string;
  correctionMode: 'smart' | 'full';
  onOriginalDocChange: (doc: string) => void;
  onModeChange: (mode: 'smart' | 'full') => void;
  onCorrect: () => void;
  onToggleAccept: (index: number) => void;
  onApply: () => void;
}

export function CorrectionPanel({
  suggestions,
  acceptedSuggestions,
  correctionModel,
  correcting,
  originalDoc,
  correctionMode,
  onOriginalDocChange,
  onModeChange,
  onCorrect,
  onToggleAccept,
  onApply,
}: CorrectionPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.container}>
      <button className={styles.toggle} onClick={() => setExpanded(!expanded)}>
        <div className={styles.toggleLeft}>
          <span className="material-symbols-outlined">spellcheck</span>
          <span className={styles.toggleTitle}>字幕校准</span>
          {suggestions.length > 0 && (
            <span className={styles.countBadge}>{suggestions.length}</span>
          )}
          {correctionModel && <span className={styles.modelTag}>{correctionModel}</span>}
        </div>
        <span className={`material-symbols-outlined ${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}>
          expand_more
        </span>
      </button>

      {expanded && (
        <div className={styles.content}>
          <p className={styles.description}>提供原始文稿，LLM 对比识别结果，只修正错别字，不改变内容意思。</p>

          <div className={styles.modeRow}>
            <button
              className={`${styles.modeBtn} ${correctionMode === 'smart' ? styles.modeBtnActive : ''}`}
              onClick={() => onModeChange('smart')}
            >
              <span className="material-symbols-outlined">bolt</span>
              智能模式
              <span className={styles.modeHint}>本地预筛 + LLM 复验</span>
            </button>
            <button
              className={`${styles.modeBtn} ${correctionMode === 'full' ? styles.modeBtnActive : ''}`}
              onClick={() => onModeChange('full')}
            >
              <span className="material-symbols-outlined">search</span>
              全量模式
              <span className={styles.modeHint}>所有字幕送 LLM 分析</span>
            </button>
          </div>

          <textarea
            className={styles.docInput}
            placeholder="在此粘贴原始文稿/脚本..."
            value={originalDoc}
            onChange={(e) => onOriginalDocChange(e.target.value)}
            rows={4}
          />

          <div className={styles.actions}>
            <Button
              variant="primary"
              loading={correcting}
              disabled={correcting || !originalDoc.trim()}
              onClick={onCorrect}
            >
              {correcting ? '校准中...' : '开始校准'}
            </Button>
            {suggestions.length > 0 && (
              <span className={styles.resultHint}>发现 {suggestions.length} 处可能的识别错误</span>
            )}
            {suggestions.length === 0 && correctionModel && !correcting && (
              <span className={styles.okHint}>✓ 未发现识别错误</span>
            )}
          </div>

          {suggestions.length > 0 && (
            <>
              <div className={styles.tableToolbar}>
                <div className={styles.tableToolbarLeft}>
                  <span className={styles.countBadge}>{suggestions.length}</span>
                  <span>处识别错误</span>
                </div>
                <div className={styles.tableToolbarRight}>
                  <button className={styles.linkBtn} onClick={() => {
                    if (acceptedSuggestions.size === suggestions.length) {
                      // deselect all — handled by parent resetting
                    }
                  }}>
                    {acceptedSuggestions.size === suggestions.length ? '取消全选' : '全选'}
                  </button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={acceptedSuggestions.size === 0}
                    onClick={onApply}
                  >
                    应用修改 {acceptedSuggestions.size > 0 && `(${acceptedSuggestions.size})`}
                  </Button>
                </div>
              </div>

              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.colCheck}></div>
                  <div className={styles.colIdx}>#</div>
                  <div className={styles.colLeft}>识别文本</div>
                  <div className={styles.colRight}>校准文本</div>
                  <div className={styles.colReason}>说明</div>
                </div>
                {suggestions.map((s, i) => {
                  const accepted = acceptedSuggestions.has(s.index);
                  const diff = computeCharDiff(s.original, s.suggested);
                  return (
                    <div
                      key={`${s.index}-${i}`}
                      className={`${styles.row} ${accepted ? styles.rowActive : ''}`}
                      onClick={() => onToggleAccept(s.index)}
                    >
                      <div className={styles.colCheck}>
                        <div className={`${styles.check} ${accepted ? styles.checkOn : ''}`}>
                          {accepted && '✓'}
                        </div>
                      </div>
                      <div className={styles.colIdx}>{s.index}</div>
                      <div className={styles.colLeft}>
                        {diff.left.map((part, j) =>
                          part.changed
                            ? <del key={j} className={styles.del}>{part.text}</del>
                            : <span key={j}>{part.text}</span>
                        )}
                      </div>
                      <div className={styles.colRight}>
                        {diff.right.map((part, j) =>
                          part.changed
                            ? <ins key={j} className={styles.ins}>{part.text}</ins>
                            : <span key={j}>{part.text}</span>
                        )}
                      </div>
                      <div className={styles.colReason}>
                        <span className={`${styles.conf} ${
                          s.confidence === 'high' ? styles.confHigh :
                          s.confidence === 'medium' ? styles.confMed : styles.confLow
                        }`}>{s.confidence === 'high' ? '高' : s.confidence === 'medium' ? '中' : '低'}</span>
                        {s.reason}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
