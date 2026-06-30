import type { TextAnalysisSplitResult } from '../../services/api';
import styles from './ApplyAnalysisDialog.module.css';

interface ConflictInfo {
  existingChapters: number;
  existingRoles: number;
  newChapters: number;
  newRoles: { name: string }[];
}

interface Props {
  conflict: ConflictInfo;
  result: TextAnalysisSplitResult;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ApplyAnalysisDialog({ conflict, onCancel, onConfirm }: Props) {
  const hasChapterConflict = conflict.existingChapters > 0;
  const hasRoleConflict = conflict.existingRoles > 0;

  let title = '应用分析结果';
  let icon = '✅';
  let message = `识别出 ${conflict.newChapters} 个章节、${conflict.newRoles.length} 个角色，将创建到项目中。`;

  if (hasChapterConflict && hasRoleConflict) {
    title = '覆盖已有内容？';
    icon = '⚠️';
    message = `已有 ${conflict.existingChapters} 个章节和 ${conflict.existingRoles} 个角色。\n\n当前分析结果：${conflict.newChapters} 个章节、${conflict.newRoles.length} 个角色。\n\n确认后将删除全部已有章节（含关联音频），覆盖同名角色，保留其余角色。`;
  } else if (hasChapterConflict) {
    title = '覆盖已有章节？';
    icon = '⚠️';
    message = `已有 ${conflict.existingChapters} 个章节。\n\n分析结果识别出 ${conflict.newChapters} 个章节。\n\n确认后将清除已有章节，用分析结果替换。`;
  } else if (hasRoleConflict) {
    title = '覆盖同名角色？';
    icon = '⚠️';
    message = `已有 ${conflict.existingRoles} 个角色，其中与分析结果同名的将被替换。\n\n分析结果识别出 ${conflict.newRoles.length} 个新角色。\n\n将删除同名旧角色（含关联音频），保留其余角色，追加新角色。`;
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={styles.dialog}>
        <div className={styles.icon}>{icon}</div>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.message}>{message}</p>
        {conflict.newRoles.length > 0 && (
          <ul className={styles.roles}>
            {conflict.newRoles.map(role => (
              <li key={role.name} className={styles.roleTag}>{role.name}</li>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnCancel}`} onClick={onCancel}>取消</button>
          <button className={`${styles.btn} ${styles.btnConfirm}`} onClick={onConfirm}>
            {hasChapterConflict ? '确认覆盖' : '确认应用'}
          </button>
        </div>
      </div>
    </div>
  );
}
