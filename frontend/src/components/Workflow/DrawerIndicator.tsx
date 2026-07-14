import styles from './DrawerIndicator.module.css';

interface Props {
  status: 'running' | 'interrupted';
  stage?: string;
  onExpand: () => void;
}

export function DrawerIndicator({ status, stage, onExpand }: Props) {
  const icon = status === 'interrupted' ? 'notifications_active' : 'progress_activity';
  const label = status === 'interrupted' ? '等待审批' : '工作流运行中';
  return (
    <button className={styles.chip} data-status={status} onClick={onExpand}>
      <span className={`material-symbols-outlined ${status === 'running' ? styles.spin : styles.pulse}`}>
        {icon}
      </span>
      <strong>{label}</strong>
      {stage && <span>· {stage}</span>}
      <span className="material-symbols-outlined">expand_more</span>
    </button>
  );
}