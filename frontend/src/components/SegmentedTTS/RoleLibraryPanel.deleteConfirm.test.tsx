import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ConfirmProvider } from '../ui/Confirm';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k), locale: 'zh-CN', setLocale: () => {} }),
}));

const deleteRole = vi.fn();
const listRoles = vi.fn();
vi.mock('../../services/api', () => ({
  roleApi: {
    listRoles: (...a: unknown[]) => listRoles(...a),
    deleteRole: (...a: unknown[]) => deleteRole(...a),
  },
}));

afterEach(() => cleanup());
beforeEach(() => { vi.clearAllMocks(); });

import { RoleLibraryPanel } from './RoleLibraryPanel';

const ROLES = [
  { id: 'r1', name: '小明', role_kind: 'cast', default_engine: 'edge_tts', default_voice: 'v1', default_engine_params: { engine: 'edge_tts' }, favorite_styles: [] },
];

function renderPanel() {
  listRoles.mockResolvedValue(ROLES);
  return render(
    <ConfirmProvider>
      <RoleLibraryPanel open onClose={vi.fn()} onRolesChanged={vi.fn()} projectId="p1" />
    </ConfirmProvider>,
  );
}

describe('RoleLibraryPanel delete confirm', () => {
  it('does NOT delete when confirm is cancelled', async () => {
    renderPanel();
    const del = await screen.findByText('segment.roleLibrary.delete');
    fireEvent.click(del);
    // ConfirmDialog appears; cancel it.
    fireEvent.click(await screen.findByRole('button', { name: 'common.cancel' }));
    expect(deleteRole).not.toHaveBeenCalled();
  });

  it('deletes after confirm and passes role name in the message', async () => {
    deleteRole.mockResolvedValue(undefined);
    renderPanel();
    const del = await screen.findByText('segment.roleLibrary.delete');
    fireEvent.click(del);
    // The confirm dialog message includes the role name.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('小明');
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith('r1'));
  });
});
