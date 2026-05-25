import React from 'react';

export interface AlertProps {
  variant?: 'success' | 'error' | 'warning' | 'info';
  children: React.ReactNode;
  onDismiss?: () => void;
  style?: React.CSSProperties;
}

export const Alert: React.FC<AlertProps> = ({ variant = 'info', children, onDismiss, style }) => {
  const variantStyles: Record<string, { backgroundColor: string; borderColor: string; color: string; icon: string }> = {
    success: {
      backgroundColor: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
      borderColor: 'var(--color-success)',
      color: 'var(--color-success)',
      icon: '✓',
    },
    error: {
      backgroundColor: 'color-mix(in srgb, var(--color-danger) 10%, transparent)',
      borderColor: 'var(--color-danger)',
      color: 'var(--color-danger)',
      icon: '✕',
    },
    warning: {
      backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
      borderColor: 'var(--color-warning)',
      color: 'var(--color-warning)',
      icon: '⚠',
    },
    info: {
      backgroundColor: 'color-mix(in srgb, var(--color-info) 10%, transparent)',
      borderColor: 'var(--color-info)',
      color: 'var(--color-info)',
      icon: 'ℹ',
    },
  };

  const variantStyle = variantStyles[variant];

  const containerStyle: React.CSSProperties = {
    padding: 'var(--spacing-md) var(--spacing-lg)',
    borderRadius: 'var(--radius-md)',
    border: `1px solid ${variantStyle.borderColor}`,
    backgroundColor: variantStyle.backgroundColor,
    color: variantStyle.color,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--spacing-sm)',
    position: 'relative',
    ...style,
  };

  const iconStyle: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 'bold',
  };

  const dismissButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: 'var(--spacing-sm)',
    right: 'var(--spacing-sm)',
    background: 'none',
    border: 'none',
    fontSize: '16px',
    cursor: 'pointer',
    color: 'inherit',
    opacity: 0.7,
    transition: 'opacity var(--transition-fast)',
  };

  return (
    <div style={containerStyle} role="alert">
      <span style={iconStyle} aria-hidden={true}>{variantStyle.icon}</span>
      <div style={{ flex: 1 }}>{children}</div>
      {onDismiss && (
        <button
          style={dismissButtonStyle}
          onClick={onDismiss}
          aria-label="Dismiss alert"
          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
        >
          ×
        </button>
      )}
    </div>
  );
};
