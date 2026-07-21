import type { ConfirmOverwriteInterrupt } from '../../services/langgraph/types';
import styles from './ConfirmPanel.module.css';

interface Props {
  interrupt: ConfirmOverwriteInterrupt;
  onRespond: (payload: { action: string }) => void;
}

export function ConfirmPanel({ interrupt, onRespond }: Props) {
  const { stats } = interrupt;
  return (
    <div className={styles.confirmPanel}>
      <div className={styles.titleRow}>
        <span className="material-symbols-outlined">warning</span>
        <strong>项目已有内容</strong>
      </div>
      <p className={styles.message}>
        当前项目已有 {stats.chapters} 个章节 / {stats.segments} 个段落
        {stats.synthesized_segments > 0 && `，其中 ${stats.synthesized_segments} 段已合成音频`}
        {stats.has_animation_brief && '，已有动画分镜 brief'}
        。继续将删除并重建这些内容。
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.confirmBtn}
          onClick={() => onRespond({ action: 'confirm' })}
        >
          确认重建
        </button>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={() => onRespond({ action: 'cancel' })}
        >
          取消
        </button>
      </div>
    </div>
  );
}
