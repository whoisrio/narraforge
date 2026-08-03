import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ToastProvider } from './Toast';
import { useToast } from './useToast';

function Harness() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success('saved ok')}>success</button>
      <button onClick={() => toast.error('boom')}>error</button>
      <button onClick={() => toast.success('first')}>first</button>
      <button onClick={() => toast.success('second')}>second</button>
    </div>
  );
}

function renderApp() {
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders an error toast with role=alert', () => {
    renderApp();
    fireEvent.click(screen.getByText('error'));
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('renders a success toast with role=status (aria-live polite)', () => {
    renderApp();
    fireEvent.click(screen.getByText('success'));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('saved ok');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('auto-dismisses after the timeout', () => {
    renderApp();
    fireEvent.click(screen.getByText('success'));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stacks multiple toasts (rapid triggers do not clear each other)', () => {
    // Regression for the audit bug: a single setTimeout id meant a second
    // trigger was cleared early by the first trigger's timeout.
    renderApp();
    fireEvent.click(screen.getByText('first'));
    fireEvent.click(screen.getByText('second'));
    expect(screen.getAllByRole('status')).toHaveLength(2);
    // Advance part of the timeout: both should still be visible.
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('clears pending timers on unmount (no setState-after-unmount)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderApp();
    fireEvent.click(screen.getByText('success'));
    unmount();
    // Advancing timers after unmount must not trigger a React warning.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining('Can\'t perform a React state update on an unmounted component'),
    );
    spy.mockRestore();
  });
});
