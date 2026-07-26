import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

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
  return render(<RoleLibraryPanel open onClose={vi.fn()} onRolesChanged={vi.fn()} projectId="p1" />);
}

describe('RoleLibraryPanel delete confirm', () => {
  it('does NOT delete when confirm is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel();
    const del = await screen.findByText('segment.roleLibrary.delete');
    fireEvent.click(del);
    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteRole).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('deletes after confirm and passes role name in the message', async () => {
    deleteRole.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel();
    const del = await screen.findByText('segment.roleLibrary.delete');
    fireEvent.click(del);
    expect(confirmSpy.mock.calls[0][0]).toContain('小明');
    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith('r1'));
    confirmSpy.mockRestore();
  });
});
