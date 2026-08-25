import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { getPronunciationMapGlobal, setPronunciationMapGlobal } = vi.hoisted(() => ({
  getPronunciationMapGlobal: vi.fn(),
  setPronunciationMapGlobal: vi.fn(),
}));
vi.mock('../../services/api', () => ({
  configApi: { getPronunciationMapGlobal, setPronunciationMapGlobal },
}));

import { PronunciationMapSetting } from './PronunciationMapSetting';

describe('PronunciationMapSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPronunciationMapGlobal.mockResolvedValue({
      entries: [{ id: 'gpm_1', source: '调动', target: '掉动', note: 'edge_tts 读错' }],
    });
    setPronunciationMapGlobal.mockImplementation(async (entries) => ({ entries }));
  });

  it('加载并展示已有全局映射', async () => {
    render(<PronunciationMapSetting />);
    await waitFor(() => expect(screen.getByDisplayValue('调动')).toBeTruthy());
    expect(screen.getByDisplayValue('掉动')).toBeTruthy();
    expect(screen.getByDisplayValue('edge_tts 读错')).toBeTruthy();
  });

  it('新增一行并保存（id 带 gpm_ 前缀）；保存前提示影响范围', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    render(<PronunciationMapSetting />);
    await waitFor(() => expect(screen.getByDisplayValue('调动')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '添加映射' }));
    const sourceInputs = screen.getAllByLabelText('映射原文');
    fireEvent.change(sourceInputs[1], { target: { value: '行长' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(setPronunciationMapGlobal).toHaveBeenCalled());
    const saved = setPronunciationMapGlobal.mock.calls[0][0];
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ source: '行长', id: expect.stringMatching(/^gpm_/) });
    vi.unstubAllGlobals();
  });

  it('删除一行后保存', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    render(<PronunciationMapSetting />);
    await waitFor(() => expect(screen.getByDisplayValue('调动')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '删除该行' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(setPronunciationMapGlobal).toHaveBeenCalledWith([]));
    vi.unstubAllGlobals();
  });

  it('后端 400 时展示错误信息', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    setPronunciationMapGlobal.mockRejectedValue({
      response: { data: { detail: { code: 'pronunciation_source_duplicate', message: 'pronunciation_source_duplicate' } } },
    });
    render(<PronunciationMapSetting />);
    await waitFor(() => expect(screen.getByDisplayValue('调动')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('pronunciation_source_duplicate'));
    vi.unstubAllGlobals();
  });
});
