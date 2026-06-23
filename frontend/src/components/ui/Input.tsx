import React from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  type?: 'text' | 'textarea';
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ type = 'text', label, error, className, ...props }) => {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: 'var(--spacing-sm) var(--spacing-md)',
    fontSize: 'var(--font-size-base)',
    border: error ? `1px solid var(--color-danger)` : `1px solid var(--color-border)`,
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    boxShadow: 'inset 0 1px 2px rgba(28, 25, 23, 0.06)',
    transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
    fontFamily: 'inherit',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: 'var(--spacing-xs)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-primary)',
  };

  const errorStyle: React.CSSProperties = {
    marginTop: 'var(--spacing-xs)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-danger)',
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'var(--color-primary)';
    e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(28, 25, 23, 0.06), 0 0 0 3px var(--glow-primary)';
    props.onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = error ? 'var(--color-danger)' : 'var(--color-border)';
    e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(28, 25, 23, 0.06)';
    props.onBlur?.(e);
  };

  const handleTextareaFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = 'var(--color-primary)';
    e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(28, 25, 23, 0.06), 0 0 0 3px var(--glow-primary)';
  };

  const handleTextareaBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = error ? 'var(--color-danger)' : 'var(--color-border)';
    e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(28, 25, 23, 0.06)';
  };

  const inputElement = type === 'textarea' ? (
    <textarea
      style={{ ...inputStyle, resize: 'vertical', minHeight: '80px' }}
      {...props as React.TextareaHTMLAttributes<HTMLTextAreaElement>}
      onFocus={handleTextareaFocus}
      onBlur={handleTextareaBlur}
    />
  ) : (
    <input
      type={type}
      style={inputStyle}
      {...props}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );

  return (
    <div className={className}>
      {label && <label style={labelStyle}>{label}</label>}
      {inputElement}
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
};
