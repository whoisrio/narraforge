import React from 'react';

export interface CardProps {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({ header, footer, children, className, style }) => {
  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-surface)',
    border: `1px solid var(--color-border)`,
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-sm)',
    overflow: 'hidden',
    ...style,
  };

  const headerStyle: React.CSSProperties = {
    padding: 'var(--spacing-md) var(--spacing-lg)',
    borderBottom: header ? `1px solid var(--color-border-light)` : 'none',
    backgroundColor: 'var(--color-surface)',
  };

  const bodyStyle: React.CSSProperties = {
    padding: 'var(--spacing-lg)',
  };

  const footerStyle: React.CSSProperties = {
    padding: 'var(--spacing-md) var(--spacing-lg)',
    borderTop: footer ? `1px solid var(--color-border-light)` : 'none',
    backgroundColor: 'var(--color-surface)',
  };

  return (
    <div className={`card ${className || ''}`} style={cardStyle}>
      {header && <div className="card-header" style={headerStyle}>{header}</div>}
      <div className="card-body" style={bodyStyle}>{children}</div>
      {footer && <div className="card-footer" style={footerStyle}>{footer}</div>}
    </div>
  );
};
