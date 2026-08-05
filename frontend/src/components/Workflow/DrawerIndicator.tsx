import { useTranslation } from '../../i18n';
import styles from './DrawerIndicator.module.css';

interface Props {
  status: 'running' | 'interrupted';
  stage?: string;
  onExpand: () => void;
}

export function DrawerIndicator({ status, stage, onExpand }: Props) {
  const { t } = useTranslation();
  const icon = status === 'interrupted' ? 'notifications_active' : 'progress_activity';
  const label = status === 'interrupted' ? t('workflow.drawerIndicator.awaitingReview') : t('workflow.drawerIndicator.running');
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