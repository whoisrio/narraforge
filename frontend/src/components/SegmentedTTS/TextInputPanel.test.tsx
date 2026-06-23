import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { textSplitApi } from '../../services/api';
import { TextInputPanel } from './TextInputPanel';

vi.mock('../../services/api', () => ({
  textSplitApi: {
    ruleSplit: vi.fn(),
  },
}));

describe('TextInputPanel split voice mode', () => {
  it('passes selected split voice mode to rule split callback', async () => {
    vi.mocked(textSplitApi.ruleSplit).mockResolvedValue(['嘉宾A：你好']);
    const onSplit = vi.fn();

    render(
      <TextInputPanel
        splitConfig={{ delimiters: ['。'], mode: 'rule' }}
        onSplitConfigChange={vi.fn()}
        onSplit={onSplit}
        onLLMSplit={vi.fn()}
        segmentTexts={[]}
        segmentCount={0}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('粘贴整段文本，拆分为多个语音段落...'), {
      target: { value: '嘉宾A：你好。' },
    });
    fireEvent.click(screen.getByRole('button', { name: /对话/ }));
    fireEvent.click(screen.getByRole('button', { name: /^拆分$/ }));

    await waitFor(() => expect(onSplit).toHaveBeenCalledWith(['嘉宾A：你好'], '嘉宾A：你好。', 'dialogue'));
  });

  it('passes selected split voice mode to LLM split callback', async () => {
    const onLLMSplit = vi.fn().mockResolvedValue(undefined);

    render(
      <TextInputPanel
        splitConfig={{ delimiters: ['。'], mode: 'llm' }}
        onSplitConfigChange={vi.fn()}
        onSplit={vi.fn()}
        onLLMSplit={onLLMSplit}
        segmentTexts={[]}
        segmentCount={0}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('粘贴整段文本，拆分为多个语音段落...'), {
      target: { value: '“你好。”' },
    });
    fireEvent.click(screen.getByRole('button', { name: /混合/ }));
    fireEvent.click(screen.getByRole('button', { name: /^拆分$/ }));

    await waitFor(() => expect(onLLMSplit).toHaveBeenCalledWith('“你好。”', 'mixed'));
  });
});
