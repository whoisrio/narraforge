import React from 'react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select: React.FC<SelectProps> = ({ label, error, options, className, ...props }) => {
  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: 'var(--spacing-sm) var(--spacing-md)',
    fontSize: 'var(--font-size-base)',
    border: error ? `1px solid var(--color-danger)` : `1px solid var(--color-border)`,
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
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

  return (
    <div className={className}>
      {label && <label style={labelStyle}>{label}</label>}
      <select
        style={selectStyle}
        {...props}
        onFocus={(e) => {
          // @ts-ignore
          e.currentTarget.style.borderColor = 'var(--color-primary)';
          // @ts-ignore
          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(25, 118, 210, 0.2)';
        }}
        onBlur={(e) => {
          // @ts-ignore
          e.currentTarget.style.borderColor = error ? 'var(--color-danger)' : 'var(--color-border)';
          // @ts-ignore
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
};
