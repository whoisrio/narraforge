import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceList } from './VoiceList';

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    voiceApi: {
      ...actual.voiceApi,
      list: vi.fn().mockResolvedValue([
        {
          id: 'v1',
          name: '测试声音',
          voice: { voice_type: 'clone', model: 'cosyvoice' },
          voice_params: {},
          created_at: '2026-01-01',
        },
      ]),
      delete: vi.fn().mockRejectedValue(new Error('boom')),
    },
  };
});

describe('VoiceList delete failure (U2)', () => {
  it('shows a user-visible error when deleting a voice fails', async () => {
    render(<VoiceList />);

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    // 失败必须给用户可见反馈，而不是只 console.error
    expect(await screen.findByText('删除失败，请重试')).toBeInTheDocument();
  });
});
