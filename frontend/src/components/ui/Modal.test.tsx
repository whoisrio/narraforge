import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Modal } from './Modal';

afterEach(() => cleanup());

describe('Modal a11y (P1 #5)', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Test">
        <p>content</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when closed', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={false} onClose={onClose} title="Test">
        <p>content</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus into the modal on open and returns focus on close', () => {
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { rerender } = render(
      <Modal isOpen onClose={() => {}} title="Test">
        <button>inside</button>
      </Modal>,
    );
    // focus moved into the modal (the inner button or the dialog container)
    expect(document.activeElement).not.toBe(opener);

    rerender(
      <Modal isOpen={false} onClose={() => {}} title="Test">
        <button>inside</button>
      </Modal>,
    );
    // focus returned to the opener
    expect(document.activeElement).toBe(opener);
    document.body.removeChild(opener);
  });

  it('renders role=dialog aria-modal for screen readers', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Test">
        <p>content</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});
