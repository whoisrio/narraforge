import { describe, expect, it } from 'vitest';
import {
  bucketMessagesByNode,
  deriveLLMPhase,
  finalStageUsage,
  mergeStageLLMData,
  messageContentToText,
  totalWorkflowUsage,
  type StreamMessageLike,
} from './llmStreams';
import type { MilestoneEvent } from './types';

describe('messageContentToText', () => {
  it('returns string content as-is', () => {
    expect(messageContentToText('你好')).toBe('你好');
  });

  it('flattens content parts and ignores non-text parts', () => {
    expect(
      messageContentToText([
        { type: 'text', text: '第一' },
        { type: 'tool_use', id: 'x' },
        '第二',
      ]),
    ).toBe('第一第二');
  });

  it('returns empty string for missing content', () => {
    expect(messageContentToText(undefined)).toBe('');
    expect(messageContentToText(null)).toBe('');
  });
});

describe('bucketMessagesByNode', () => {
  const nodeById: Record<string, string> = { m1: 'gen_script', m2: 'gen_script', m3: 'synthesis' };
  const getNode = (m: StreamMessageLike) => (m.id ? nodeById[m.id] : undefined);

  it('buckets AI messages by node with latest text and summed usage', () => {
    const messages: StreamMessageLike[] = [
      { id: 'm1', type: 'ai', content: '第一版', usage_metadata: { input_tokens: 100, output_tokens: 50 } },
      { id: 'm2', type: 'ai', content: '第二版', usage_metadata: { input_tokens: 200, output_tokens: 80 } },
      { id: 'm3', type: 'ai', content: '其他节点' },
    ];
    const buckets = bucketMessagesByNode(messages, getNode);
    expect(buckets.gen_script.text).toBe('第二版');
    expect(buckets.gen_script.calls).toBe(2);
    expect(buckets.gen_script.usage).toEqual({ input_tokens: 300, output_tokens: 130, total_tokens: 430 });
    expect(buckets.synthesis.calls).toBe(1);
    expect(buckets.synthesis.usage).toBeUndefined();
  });

  it('ignores non-AI messages and messages without a node', () => {
    const messages: StreamMessageLike[] = [
      { id: 'm1', type: 'human', content: 'prompt' },
      { id: 'unknown', type: 'ai', content: 'orphan' },
    ];
    expect(bucketMessagesByNode(messages, getNode)).toEqual({});
  });
});

const ev = (type: MilestoneEvent['type']): MilestoneEvent => ({ type, stage: 's', message: '', data: {} });

describe('deriveLLMPhase', () => {
  it('is idle without events or without LLM events', () => {
    expect(deriveLLMPhase(undefined)).toBe('idle');
    expect(deriveLLMPhase([ev('stage_start')])).toBe('idle');
  });

  it('is streaming after llm_call / llm_streaming', () => {
    expect(deriveLLMPhase([ev('llm_call')])).toBe('streaming');
    expect(deriveLLMPhase([ev('llm_call'), ev('llm_streaming')])).toBe('streaming');
  });

  it('is done after llm_response / stage_complete / error', () => {
    expect(deriveLLMPhase([ev('llm_call'), ev('llm_response')])).toBe('done');
    expect(deriveLLMPhase([ev('llm_call'), ev('stage_complete')])).toBe('done');
    expect(deriveLLMPhase([ev('llm_call'), ev('error')])).toBe('done');
  });

  it('returns to streaming when a retry starts a new call', () => {
    expect(deriveLLMPhase([ev('llm_call'), ev('llm_response'), ev('llm_call')])).toBe('streaming');
  });
});

describe('finalStageUsage', () => {
  it('returns the usage of the last stage_complete event', () => {
    const events: MilestoneEvent[] = [
      { type: 'stage_complete', stage: 's', message: '', data: { usage: { input_tokens: 1, output_tokens: 2 } } },
      { type: 'stage_complete', stage: 's', message: '', data: { usage: { input_tokens: 3, output_tokens: 4 } } },
    ];
    expect(finalStageUsage(events)).toEqual({ input_tokens: 3, output_tokens: 4 });
  });

  it('is undefined without stage_complete usage', () => {
    expect(finalStageUsage([ev('llm_response')])).toBeUndefined();
    expect(finalStageUsage(undefined)).toBeUndefined();
  });
});

describe('mergeStageLLMData', () => {
  it('prefers stage_complete usage over live usage and derives phase', () => {
    const merged = mergeStageLLMData(
      { gen_script: { text: '正文', reasoning: '', calls: 1, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } },
      {
        gen_script: [
          { type: 'stage_complete', stage: 'gen_script', message: '', data: { usage: { input_tokens: 12, output_tokens: 6 } } },
        ],
        synthesis: [ev('llm_call')],
      },
    );
    expect(merged.gen_script).toEqual({
      text: '正文',
      reasoning: '',
      calls: 1,
      phase: 'done',
      usage: { input_tokens: 12, output_tokens: 6 },
      liveUsage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
    expect(merged.synthesis).toEqual({ text: '', reasoning: '', calls: 0, phase: 'streaming', usage: undefined, liveUsage: undefined });
  });

  it('omits stages without any LLM activity', () => {
    expect(mergeStageLLMData({}, { split_segment: [ev('stage_start')] })).toEqual({});
  });

  it('uses persisted state usage when milestones are unavailable (reattach)', () => {
    const merged = mergeStageLLMData({}, {}, {
      gen_script: { input_tokens: 100, output_tokens: 50, total_tokens: 150, reasoning_tokens: 30 },
    });
    expect(merged.gen_script).toEqual({
      text: '',
      reasoning: '',
      calls: 0,
      phase: 'done',
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, reasoning_tokens: 30 },
      liveUsage: undefined,
    });
  });
});

describe('reasoning & workflow totals', () => {
  it('buckets reasoning_content from additional_kwargs', () => {
    const buckets = bucketMessagesByNode(
      [
        {
          type: 'ai',
          content: '答案',
          additional_kwargs: { reasoning_content: '思考过程…' },
          usage_metadata: {
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
            output_token_details: { reasoning: 15 },
          },
        },
      ],
      () => 'gen_script',
    );
    expect(buckets.gen_script.reasoning).toBe('思考过程…');
    expect(buckets.gen_script.usage).toEqual({
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      reasoning_tokens: 15,
    });
  });

  it('sums per-stage usage into workflow-wide totals', () => {
    const total = totalWorkflowUsage({
      gen_script: {
        text: '',
        reasoning: '',
        calls: 1,
        phase: 'done',
        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300, reasoning_tokens: 150 },
      },
      script_review: {
        text: '',
        reasoning: '',
        calls: 1,
        phase: 'streaming',
        liveUsage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    });
    expect(total).toEqual({
      input_tokens: 110,
      output_tokens: 205,
      total_tokens: 315,
      reasoning_tokens: 150,
    });
    expect(totalWorkflowUsage({})).toBeUndefined();
  });
});
