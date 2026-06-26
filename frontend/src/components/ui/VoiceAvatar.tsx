import { getVoiceAvatarSrc } from '../../services/voiceAvatar';
import styles from './VoiceAvatar.module.css';

interface VoiceAvatarProps {
  name: string;
  /** Custom avatar URL (data URL or remote URL). Takes precedence over voice avatar lookup. */
  avatar?: string | null;
  size?: number;
  gender?: string;
  engine?: string;
  /** 第一行：音色名称 */
  label?: string;
  /** 第二行：模型名称 */
  sublabel?: string;
  className?: string;
}

const ENGINE_COLORS: Record<string, string> = {
  edge_tts: '#6366f1',
  cosyvoice: '#f59e0b',
  mimo_tts: '#10b981',
  voxcpm: '#ec4899',
};

/**
 * 音色头像组件
 * 优先使用自定义 avatar，其次使用本地 PNG 头像，最后使用首字母 + 引擎色
 */
export function VoiceAvatar({ name, avatar, size = 40, gender, engine, label, sublabel, className }: VoiceAvatarProps) {
  // Priority: custom avatar > voice avatar map > initial + engine color
  const voiceSrc = !avatar ? getVoiceAvatarSrc(name, gender) : null;
  const hasImage = !!avatar || !!voiceSrc;

  const avatarEl = (
    <div
      className={styles.avatar}
      style={{ width: size, height: size }}
      title={name}
    >
      {hasImage ? (
        <img
          src={avatar ?? voiceSrc!}
          alt={name}
          className={styles.image}
          draggable={false}
        />
      ) : (
        <span
          className={styles.initial}
          style={{ backgroundColor: ENGINE_COLORS[engine ?? ''] ?? '#867467', fontSize: size * 0.4 }}
        >
          {(name || '?').slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );

  if (!label && !sublabel) return avatarEl;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        maxWidth: size * 1.8,
      }}
    >
      {avatarEl}
      {label && (
        <span style={{
          fontSize: Math.max(10, size * 0.24),
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
          textAlign: 'center',
          lineHeight: 1.2,
        }}>
          {label}
        </span>
      )}
      {sublabel && (
        <span style={{
          fontSize: Math.max(9, size * 0.2),
          fontWeight: 400,
          color: 'var(--color-text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
          textAlign: 'center',
          lineHeight: 1.2,
        }}>
          {sublabel}
        </span>
      )}
    </div>
  );
}
