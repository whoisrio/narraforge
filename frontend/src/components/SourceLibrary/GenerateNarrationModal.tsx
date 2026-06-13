import { useState } from 'react';
import type { SourceDocument } from '../../types';
import styles from './GenerateNarrationModal.module.css';

interface GenerateNarrationModalProps {
  sources: SourceDocument[];
  onClose: () => void;
  onGenerate: (selectedSourceIds: string[], promptHint: string) => void;
}

export function GenerateNarrationModal({ sources, onClose, onGenerate }: GenerateNarrationModalProps) {
  // 默认全选
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(sources.map(s => s.id))
  );
  const [promptHint, setPromptHint] = useState('');
  const [targetChapters, setTargetChapters] = useState(3);
  const [targetWords, setTargetWords] = useState('1000-1500 字');
  const [engine, setEngine] = useState('mimo');

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    if (selectedIds.size === 0) return;
    onGenerate(Array.from(selectedIds), promptHint);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>🧠 生成旁白文档</h2>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <p className={styles.desc}>
          从选中源合成一份适合朗读的口播稿，并按 # 二级标题切到各章节。
        </p>

        <div className={styles.section}>
          <label className={styles.label}>📚 选中的源 ({selectedIds.size}/{sources.length})</label>
          <div className={styles.sourceList}>
            {sources.map(src => {
              const selected = selectedIds.has(src.id);
              return (
                <button
                  key={src.id}
                  className={`${styles.sourceChip} ${selected ? styles.sourceChipSelected : ''}`}
                  onClick={() => toggleId(src.id)}
                  type="button"
                >
                  <span className={styles.chk}>{selected ? '✓' : '·'}</span>
                  <span className={styles.chipIcon}>
                    {src.source_type === 'paste' ? '📄' : src.source_type === 'audio' ? '🎵' : '🔗'}
                  </span>
                  <span className={styles.chipTitle}>{src.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>📝 补充提示（可选）</label>
          <textarea
            className={styles.textarea}
            placeholder="例如: 保持轻松风格, 多用反问, 避免专业术语堆砌…"
            value={promptHint}
            onChange={e => setPromptHint(e.target.value)}
            rows={3}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>🎯 目标章节</label>
            <input
              type="number"
              min={1}
              max={10}
              value={targetChapters}
              onChange={e => setTargetChapters(parseInt(e.target.value, 10) || 1)}
              className={styles.input}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>📏 字数</label>
            <input
              type="text"
              value={targetWords}
              onChange={e => setTargetWords(e.target.value)}
              className={styles.input}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>🤖 引擎</label>
            <select
              value={engine}
              onChange={e => setEngine(e.target.value)}
              className={styles.input}
            >
              <option value="mimo">MiMo (推荐)</option>
              <option value="qwen">Qwen</option>
              <option value="rule">纯规则</option>
            </select>
          </div>
        </div>

        <div className={styles.note}>
          ⏱ 生成可能需要 10-30 秒 · 新版本会成为项目活跃版本 · 旧版本保留可对比
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>取消</button>
          <button
            className={styles.primaryBtn}
            onClick={handleSubmit}
            disabled={selectedIds.size === 0}
          >
            🧠 生成新版本
          </button>
        </div>
      </div>
    </div>
  );
}
