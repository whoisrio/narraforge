import React, { useEffect, useRef } from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'cta';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

const spinnerStyleId = 'dark-studio-pro-spinner-style';

function ensureSpinnerStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(spinnerStyleId)) return;
  const style = document.createElement('style');
  style.id = spinnerStyleId;
  style.textContent = `
    @keyframes dsp-spin {
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
    transition: 'background-color var(--transition-normal), color var(--transition-normal), border-color var(--transition-normal), opacity var(--transition-normal), box-shadow var(--transition-normal), transform 0.1s ease',
    cursor: 'pointer',
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
  };

  const getVariantStyles = (): React.CSSProperties => {
    const variantStyles: Record<string, React.CSSProperties> = {
      primary: {
        backgroundColor: 'var(--color-primary)',
        color: 'var(--color-text-on-primary, white)',
        boxShadow: '0 0 16px var(--glow-primary)',
      },
      secondary: {
        backgroundColor: 'transparent',
        color: 'var(--color-primary)',
        borderColor: 'var(--color-primary)',
      },
      danger: {
        backgroundColor: 'var(--color-danger)',
        color: 'var(--color-text-on-primary, white)',
      },
      ghost: {
        backgroundColor: 'var(--color-surface-hover)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border-light)',
        borderRadius: 'var(--radius-md)',
      },
      cta: {
        backgroundColor: 'var(--color-cta)',
        color: 'var(--color-text-on-primary, white)',
      },
    };
    return variantStyles[variant] || {};
  };

  const getSizeStyles = (): React.CSSProperties => {
    const sizes: Record<string, React.CSSProperties> = {
      sm: { padding: 'var(--spacing-xs) var(--spacing-md)', fontSize: 'var(--font-size-sm)' },
      md: { padding: '11px 22px', fontSize: 'var(--font-size-base)' },
      lg: { padding: '14px 28px', fontSize: 'var(--font-size-lg)', fontWeight: 300 },
    };
    return sizes[size] || {};
  };

  const handleMouseEnter = () => {
    const btn = buttonRef.current;
    if (!btn || disabled || loading) return;
    if (variant === 'primary') {
      btn.style.backgroundColor = 'var(--color-primary-light)';
      btn.style.boxShadow = '0 0 24px var(--glow-primary-strong)';
    } else if (variant === 'cta') {
      btn.style.backgroundColor = 'var(--color-cta-hover)';
    }
  };

  const handleMouseLeave = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    if (variant === 'primary') {
      btn.style.backgroundColor = 'var(--color-primary)';
      btn.style.boxShadow = '0 0 16px var(--glow-primary)';
    } else if (variant === 'cta') {
      btn.style.backgroundColor = 'var(--color-cta)';
    }
  };

  const spinnerStyle: React.CSSProperties = {
    display: 'inline-block',
    width: '1em',
    height: '1em',
    border: '2px solid currentColor',
    borderTopColor: 'transparent',
    borderRadius: '50%',
    animation: 'dsp-spin 0.6s linear infinite',
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