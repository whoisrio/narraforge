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
      target: { value: '”你好。”' },
    });
    fireEvent.click(screen.getByRole('button', { name: /对话/ }));
    fireEvent.click(screen.getByRole('button', { name: /^拆分$/ }));

    await waitFor(() => expect(onLLMSplit).toHaveBeenCalledWith('”你好。”', 'dialogue'));
  });
});

describe('TextInputPanel Library source linking', () => {
  it('prefills split textarea from Library chapter text when no segments exist', () => {
    render(
      <TextInputPanel
        splitConfig={{ delimiters: ['。'], mode: 'rule' }}
        onSplitConfigChange={vi.fn()}
        onSplit={vi.fn()}
        onLLMSplit={vi.fn()}
        sourceText="来自文本库的章节全文。"
        segmentTexts={[]}
        segmentCount={0}
      />,
    );

    expect(screen.getByPlaceholderText('粘贴整段文本，拆分为多个语音段落...')).toHaveValue('来自文本库的章节全文。');
  });

  it('syncs the split textarea when entering a different empty chapter', async () => {
    const props = {
      splitConfig: { delimiters: ['。'], mode: 'rule' as const },
      onSplitConfigChange: vi.fn(),
      onSplit: vi.fn(),
      onLLMSplit: vi.fn(),
      segmentTexts: [],
      segmentCount: 0,
    };
    const { rerender } = render(
      <TextInputPanel
        {...props}
        chapterId="chapter-a"
        chapterName="第一章"
        sourceText="第一章全文。"
      />,
    );

    expect(screen.getByPlaceholderText('粘贴整段文本，拆分为多个语音段落...')).toHaveValue('第一章全文。');

    fireEvent.change(screen.getByPlaceholderText('粘贴整段文本，拆分为多个语音段落...'), {
      target: { value: '临时草稿，不应带到第二章。' },
    });

    rerender(
      <TextInputPanel
        {...props}
        chapterId="chapter-b"
        chapterName="第二章"
        sourceText="第二章全文。"
      />,
    );

    await waitFor(() => expect(screen.getByPlaceholderText('粘贴整段文本，拆分为多个语音段落...')).toHaveValue('第二章全文。'));
    expect(screen.getByText('第二章')).toBeInTheDocument();
  });

  it('keeps showing the Library chapter text when the chapter already has segments', () => {
    render(
      <TextInputPanel
        splitConfig={{ delimiters: ['。'], mode: 'rule' }}
        onSplitConfigChange={vi.fn()}
        onSplit={vi.fn()}
        onLLMSplit={vi.fn()}
        chapterId="chapter-with-segments"
        chapterName="已有分段章节"
        sourceText="文本库里的完整章节内容。"
        segmentTexts={['旧分段一。', '旧分段二。']}
        segmentCount={2}
      />,
    );

    expect(screen.getByPlaceholderText('粘贴整段文本，拆分为多个语音段落...')).toHaveValue('文本库里的完整章节内容。');
    expect(screen.getByText('文本库已更新，建议重新拆分')).toBeInTheDocument();
  });

  it('detects stale segments when Library text changes and can replace the split draft with Library text', async () => {
    vi.mocked(textSplitApi.ruleSplit).mockResolvedValue(['新文本']);
    const onSplit = vi.fn();

    render(
      <TextInputPanel
        splitConfig={{ delimiters: ['。'], mode: 'rule' }}
        onSplitConfigChange={vi.fn()}
        onSplit={onSplit}
        onLLMSplit={vi.fn()}
        sourceText="新文本。"
        segmentTexts={['旧文本。']}
        segmentCount={1}
      />,
    );

    expect(screen.getByText('文本库已更新，建议重新拆分')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /使用文本库全文/ }));
    expect(screen.getByPlaceholderText('粘贴整段文本，拆分为多个语音段落...')).toHaveValue('新文本。');

    fireEvent.click(screen.getByRole('button', { name: /^重新拆分$/ }));
    await waitFor(() => expect(onSplit).toHaveBeenCalledWith(['新文本'], '新文本。', 'narration'));
  });
});
