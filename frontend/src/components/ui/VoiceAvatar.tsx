import { getVoiceAvatarSrc } from '../../services/voiceAvatar';

interface VoiceAvatarProps {
  name: string;
  size?: number;
  gender?: string;
  /** 显示在头像下方的标签（如 "Edge-TTS · Xiaoxiao"） */
  label?: string;
  className?: string;
}

/**
 * 音色头像组件
 * 使用本地 PNG 头像，圆形裁剪，可选标签
 */
export function VoiceAvatar({ name, size = 40, gender, label, className }: VoiceAvatarProps) {
  const src = getVoiceAvatarSrc(name, gender);

  const avatar = (
    <img
      src={src}
      alt={name}
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        flexShrink: 0,
        border: '2px solid rgba(255,255,255,0.8)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        userSelect: 'none',
      }}
      draggable={false}
    />
  );

  if (!label) return avatar;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {avatar}
      <span style={{
        fontSize: Math.max(9, size * 0.25),
        fontWeight: 500,
        color: 'var(--color-text-muted)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: size * 2,
        textAlign: 'center',
        lineHeight: 1.2,
      }}>
        {label}
      </span>
    </div>
  );
}
