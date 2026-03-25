import React from 'react';

export interface AlertProps {
  variant?: 'success' | 'error' | 'warning' | 'info';
  children: React.ReactNode;
  onDismiss?: () => void;
}

export const Alert: React.FC<AlertProps> = ({ variant = 'info', children, onDismiss }) => {
  const variantStyles: Record<string, { backgroundColor: string; borderColor: string; color: string; icon: string }> = {
    success: {
      backgroundColor: 'rgba(76, 175, 80, 0.1)',
      borderColor: '#4caf50',
      color: '#2e7d32',
      icon: '✓',
    },
    error: {
      backgroundColor: 'rgba(244, 67, 54, 0.1)',
      borderColor: '#f44336',
      color: '#c62828',
      icon: '✕',
    },
    warning: {
      backgroundColor: 'rgba(255, 152, 0, 0.1)',
      borderColor: '#ff9800',
      color: '#ef6c00',
      icon: '⚠',
    },
    info: {
      backgroundColor: 'rgba(0, 188, 212, 0.1)',
      borderColor: '#00bcd4',
      color: '#00838f',
      icon: 'ℹ',
    },
  };

  const style = variantStyles[variant];

  const containerStyle: React.CSSProperties = {
    padding: 'var(--spacing-md) var(--spacing-lg)',
    borderRadius: 'var(--radius-md)',
    border: `1px solid ${style.borderColor}`,
    backgroundColor: style.backgroundColor,
    color: style.color,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--spacing-sm)',
    position: 'relative',
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
      <span style={iconStyle} aria-hidden="true">{style.icon}</span>
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
