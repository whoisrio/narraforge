import React, { useRef } from 'react';

export interface CardProps {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  interactive?: boolean;
}

export const Card: React.FC<CardProps> = ({ header, footer, children, className, style, interactive }) => {
  const cardRef = useRef<HTMLDivElement>(null);

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    color: 'var(--color-text-primary)',
    boxShadow: 'var(--shadow-card)',
    transition: 'box-shadow 200ms ease, transform 200ms ease',
    cursor: interactive ? 'pointer' : 'default',
    ...style,
  };

  const headerStyle: React.CSSProperties = {
    padding: 'var(--spacing-md) var(--spacing-lg)',
    borderBottom: header ? '1px solid var(--color-border)' : 'none',
    backgroundColor: 'var(--color-surface)',
  };

  const bodyStyle: React.CSSProperties = {
    padding: 'var(--spacing-lg)',
  };

  const footerStyle: React.CSSProperties = {
    padding: 'var(--spacing-md) var(--spacing-lg)',
    borderTop: footer ? '1px solid var(--color-border)' : 'none',
    backgroundColor: 'var(--color-surface)',
  };

  const handleMouseEnter = () => {
    if (!interactive || !cardRef.current) return;
    cardRef.current.style.boxShadow = 'var(--shadow-card-hover)';
    cardRef.current.style.transform = 'translateY(-2px)';
  };

  const handleMouseLeave = () => {
    if (!interactive || !cardRef.current) return;
    cardRef.current.style.boxShadow = 'var(--shadow-card)';
    cardRef.current.style.transform = 'translateY(0)';
  };

  return (
    <div
      ref={cardRef}
      className={`card ${className || ''}`}
      style={cardStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {header && <div className="card-header" style={headerStyle}>{header}</div>}
      <div className="card-body" style={bodyStyle}>{children}</div>
      {footer && <div className="card-footer" style={footerStyle}>{footer}</div>}
    </div>
  );
};
