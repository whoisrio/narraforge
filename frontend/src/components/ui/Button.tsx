import React, { useEffect, useRef } from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'cta';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

const spinnerStyleId = 'vs-spinner-style';

function ensureSpinnerStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(spinnerStyleId)) return;
  const style = document.createElement('style');
  style.id = spinnerStyleId;
  style.textContent = `
    @keyframes vs-spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  ...props
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ensureSpinnerStyle();
  }, []);

  const buttonStyle: React.CSSProperties = {
    transition: 'all 200ms ease',
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    border: '1px solid transparent',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--spacing-xs)',
    opacity: disabled || loading ? 0.6 : 1,
    pointerEvents: disabled || loading ? 'none' : 'auto',
    width: fullWidth ? '100%' : 'auto',
    borderRadius: 'var(--radius-full)',
    position: 'relative',
    overflow: 'hidden',
  };

  const getVariantStyles = (): React.CSSProperties => {
    const variantStyles: Record<string, React.CSSProperties> = {
      primary: {
        background: 'var(--color-primary-gradient)',
        color: 'var(--color-text-on-primary)',
        boxShadow: '0 2px 8px var(--glow-primary)',
      },
      secondary: {
        backgroundColor: 'transparent',
        color: 'var(--color-primary)',
        borderColor: 'var(--color-primary)',
      },
      danger: {
        backgroundColor: 'var(--color-danger)',
        color: 'var(--color-text-on-primary)',
      },
      ghost: {
        backgroundColor: 'var(--color-surface-hover)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      },
      cta: {
        backgroundColor: 'var(--color-cta)',
        color: 'var(--color-text-on-primary)',
      },
    };
    return variantStyles[variant] || {};
  };

  const getSizeStyles = (): React.CSSProperties => {
    const sizes: Record<string, React.CSSProperties> = {
      sm: { padding: 'var(--spacing-xs) var(--spacing-md)', fontSize: 'var(--font-size-sm)' },
      md: { padding: '11px 22px', fontSize: 'var(--font-size-base)' },
      lg: { padding: '14px 28px', fontSize: 'var(--font-size-lg)', fontWeight: 500 },
    };
    return sizes[size] || {};
  };

  const handleMouseEnter = () => {
    const btn = buttonRef.current;
    if (!btn || disabled || loading) return;
    if (variant === 'primary') {
      btn.style.boxShadow = '0 4px 16px var(--glow-primary-strong)';
      btn.style.transform = 'scale(1.02)';
    } else if (variant === 'cta') {
      btn.style.backgroundColor = 'var(--color-cta-hover)';
      btn.style.transform = 'scale(1.02)';
    } else if (variant === 'ghost') {
      btn.style.backgroundColor = 'var(--color-surface-active)';
    }
  };

  const handleMouseLeave = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    if (variant === 'primary') {
      btn.style.boxShadow = '0 2px 8px var(--glow-primary)';
      btn.style.transform = 'scale(1)';
    } else if (variant === 'cta') {
      btn.style.backgroundColor = 'var(--color-cta)';
      btn.style.transform = 'scale(1)';
    } else if (variant === 'ghost') {
      btn.style.backgroundColor = 'var(--color-surface-hover)';
    }
  };

  const spinnerStyle: React.CSSProperties = {
    display: 'inline-block',
    width: '1em',
    height: '1em',
    border: '2px solid currentColor',
    borderTopColor: 'transparent',
    borderRadius: '50%',
    animation: 'vs-spin 0.6s linear infinite',
    marginRight: 'var(--spacing-xs)',
    verticalAlign: 'middle',
  };

  return (
    <button
      ref={buttonRef}
      style={{ ...buttonStyle, ...getVariantStyles(), ...getSizeStyles() }}
      disabled={disabled || loading}
      className={className}
      aria-busy={loading}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      {loading && <span style={spinnerStyle} />}
      {children}
    </button>
  );
};
