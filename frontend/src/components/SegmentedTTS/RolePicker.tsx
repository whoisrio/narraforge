import type { Role, RoleSnapshot } from '../../types';
import styles from './RolePicker.module.css';

interface RolePickerProps {
  roles: Role[];
  value?: string | null;
  label?: string;
  onChange: (roleId: string | null, snapshot: RoleSnapshot | null) => void;
  onManage: () => void;
}

function toSnapshot(role: Role): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    avatar: role.avatar,
    description: role.description,
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: { ...role.default_engine_params },
    favorite_styles: [...role.favorite_styles],
  };
}

export function RolePicker({ roles, value, label = '角色', onChange, onManage }: RolePickerProps) {
  return (
    <label className={styles.root}>
      <span className={styles.label}>{label}</span>
      <div className={styles.controls}>
        <select
          className={styles.select}
          value={value ?? ''}
          onChange={(event) => {
            const role = roles.find((item) => item.id === event.target.value);
            onChange(role?.id ?? null, role ? toSnapshot(role) : null);
          }}
        >
          <option value="">未选择</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>{role.name}</option>
          ))}
        </select>
        <button type="button" className={styles.manageButton} onClick={onManage}>管理</button>
      </div>
    </label>
  );
}
