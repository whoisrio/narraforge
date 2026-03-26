import React, { useEffect } from 'react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 'var(--spacing-lg)',
  };

  const modalStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-xl)',
    maxWidth: '90%',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
  };

  const headerStyle: React.CSSProperties = {
    padding: 'var(--spacing-md) var(--spacing-lg)',
    borderBottom: title ? `1px solid var(--color-border-light)` : 'none',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const bodyStyle: React.CSSProperties = {
    padding: 'var(--spacing-lg)',
  };

  const footerStyle: React.CSSProperties = {
    padding: 'var(--spacing-md) var(--spacing-lg)',
    borderTop: footer ? `1px solid var(--color-border-light)` : 'none',
    display: 'flex',
    gap: 'var(--spacing-sm)',
    justifyContent: 'flex-end',
  };

  const closeButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: 'var(--color-text-secondary)',
    padding: 'var(--spacing-xs)',
    borderRadius: 'var(--radius-sm)',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {(title) && (
          <div style={headerStyle}>
            <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' }}>{title}</h2>
            <button
              style={closeButtonStyle}
              onClick={onClose}
              aria-label="Close modal"
            >
              ×
            </button>
          </div>
        )}
        <div style={bodyStyle}>{children}</div>
        {footer && <div style={footerStyle}>{footer}</div>}
      </div>
    </div>
  );
};
