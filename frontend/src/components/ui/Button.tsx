import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
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
  const buttonStyle: React.CSSProperties = {
    transition: 'background-color var(--transition-normal), color var(--transition-normal), border-color var(--transition-normal), opacity var(--transition-normal)',
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
  };

  const getVariantStyles = () => {
    const variantStyles: Record<string, React.CSSProperties> = {
      primary: {
        backgroundColor: 'var(--color-primary)',
        color: 'white',
      },
      secondary: {
        backgroundColor: 'var(--color-secondary)',
        color: 'white',
      },
      danger: {
        backgroundColor: 'var(--color-danger)',
        color: 'white',
      },
      ghost: {
        backgroundColor: 'transparent',
        color: 'var(--color-text-primary)',
        borderColor: 'var(--color-border)',
      },
    };
    return variantStyles[variant];
  };

  const getSizeStyles = () => {
    const sizes: Record<string, React.CSSProperties> = {
      sm: { padding: 'var(--spacing-xs) var(--spacing-sm)', fontSize: 'var(--font-size-sm)' },
      md: { padding: 'var(--spacing-sm) var(--spacing-md)', fontSize: 'var(--font-size-base)' },
      lg: { padding: 'var(--spacing-md) var(--spacing-lg)', fontSize: 'var(--font-size-lg)' },
    };
    return sizes[size];
  };

  return (
    <button
      style={{ ...buttonStyle, ...getVariantStyles(), ...getSizeStyles(), ...(className ? {} : {}) }}
      disabled={disabled || loading}
      className={className}
      aria-busy={loading}
      {...props}
    >
      {loading && <span style={{ display: 'inline-block', marginRight: '4px' }}>⟳</span>}
      {children}
    </button>
  );
};
