import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider } from './Confirm';
import { useConfirm } from './useConfirm';

function Harness() {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () => {
        const ok = await confirm({ title: 'Delete?', message: 'Are you sure?' });
        // stash result on the button for assertions
        (document.body as unknown as { _result?: boolean })._result = ok;
      }}
    >
      ask
    </button>
  );
}

function renderApp() {
  return render(
    <ConfirmProvider>
      <Harness />
    </ConfirmProvider>,
  );
}

function getResult(): boolean | undefined {
  return (document.body as unknown as { _result?: boolean })._result;
}

describe('useConfirm', () => {
  it('renders nothing until confirm() is called', () => {
    renderApp();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resolves true when the confirm button is clicked', async () => {
    renderApp();
    fireEvent.click(screen.getByText('ask'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete?');
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await act(async () => { /* flush promise */ });
    expect(getResult()).toBe(true);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resolves false when the cancel button is clicked', async () => {
    renderApp();
    fireEvent.click(screen.getByText('ask'));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await act(async () => { /* flush promise */ });
    expect(getResult()).toBe(false);
  });

  it('resolves false when the overlay (click-outside) is clicked', async () => {
    renderApp();
    fireEvent.click(screen.getByText('ask'));
    const dialog = await screen.findByRole('alertdialog');
    // Click the overlay (the dialog's parent).
    fireEvent.click(dialog.parentElement as HTMLElement);
    await act(async () => { /* flush promise */ });
    expect(getResult()).toBe(false);
  });

  it('resolves false when Escape is pressed', async () => {
    renderApp();
    fireEvent.click(screen.getByText('ask'));
    await screen.findByRole('alertdialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => { /* flush promise */ });
    expect(getResult()).toBe(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
