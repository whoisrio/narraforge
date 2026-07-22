/**
 * Pure helpers to bucket LangGraph `messages`-channel output per graph node.
 *
 * Consumption model (SDK @langchain/langgraph-sdk 1.9.x):
 * - `stream.messages` holds message dicts aggregated by message id: all token
 *   chunks of one LLM call are concatenated into a single growing entry.
 * - `stream.getMessagesMetadata(msg, i)?.streamMetadata?.langgraph_node` tells
 *   which graph node produced the message.
 * - The aggregated AI message carries `usage_metadata` once the model reports
 *   it (usually on the final chunk).
 */
import type { MilestoneEvent, TokenUsage } from './types';

/** Minimal structural shape of a `stream.messages` entry. */
export interface StreamMessageLike {
  id?: string | null;
  type?: string;
  content?: unknown;
  additional_kwargs?: {
    /** Thinking-mode providers (Qwen) stream thought deltas under this key. */
    reasoning_content?: unknown;
  } | null;
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    output_token_details?: { reasoning?: number } | null;
  } | null;
}

/** LLM activity phase of a stage, derived from its milestone events. */
export type LLMPhase = 'idle' | 'streaming' | 'done';

export interface StageLLMStream {
  /** Text of the node's latest AI message (grows while streaming). */
  text: string;
  /** Thought process of the node's latest AI message (reasoning_content). */
  reasoning: string;
  /** Summed usage across the node's AI messages; undefined until reported. */
  usage?: TokenUsage;
  /** Number of AI messages (LLM calls) seen for the node. */
  calls: number;
}

/** Flatten LangChain message content (string or content parts) to plain text. */
export function messageContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .join('');
}

function addUsage(a: TokenUsage | undefined, b: NonNullable<StreamMessageLike['usage_metadata']>): TokenUsage {
  const input = (a?.input_tokens ?? 0) + (b.input_tokens ?? 0);
  const output = (a?.output_tokens ?? 0) + (b.output_tokens ?? 0);
  const reasoning = (a?.reasoning_tokens ?? 0) + (b.output_token_details?.reasoning ?? 0);
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    ...(reasoning > 0 ? { reasoning_tokens: reasoning } : {}),
  };
}

/**
 * Bucket AI messages by graph node. For each node: the latest message's text
 * (the live stream) and reasoning, summed usage, and the call count.
 */
export function bucketMessagesByNode<M extends StreamMessageLike>(
  messages: readonly M[],
  getNode: (message: M, index: number) => string | undefined,
): Record<string, StageLLMStream> {
  const buckets: Record<string, StageLLMStream> = {};
  messages.forEach((message, index) => {
    if (message.type !== 'ai') return;
    const node = getNode(message, index);
    if (!node) return;
    const bucket = (buckets[node] ??= { text: '', reasoning: '', calls: 0 });
    bucket.text = messageContentToText(message.content);
    const reasoning = message.additional_kwargs?.reasoning_content;
    if (typeof reasoning === 'string') bucket.reasoning = reasoning;
    bucket.calls += 1;
    if (message.usage_metadata) bucket.usage = addUsage(bucket.usage, message.usage_metadata);
  });
  return buckets;
}

const STREAMING_EVENTS = new Set(['llm_call', 'llm_streaming']);
const TERMINAL_EVENTS = new Set(['llm_response', 'stage_complete', 'error']);

/** Derive the LLM phase from a node's milestone events (latest wins). */
export function deriveLLMPhase(events: readonly MilestoneEvent[] | undefined): LLMPhase {
  if (!events?.length) return 'idle';
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const type = events[i].type;
    if (STREAMING_EVENTS.has(type)) return 'streaming';
    if (TERMINAL_EVENTS.has(type)) return 'done';
  }
  return 'idle';
}

/** Final per-stage usage from the stage_complete custom event, if present. */
export function finalStageUsage(events: readonly MilestoneEvent[] | undefined): TokenUsage | undefined {
  if (!events?.length) return undefined;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === 'stage_complete' && event.data.usage) return event.data.usage;
  }
  return undefined;
}

/** Per-stage LLM view model consumed by StageCard / StageLLMPane. */
export interface StageLLMData {
  /** Latest AI message text of the stage (grows while streaming). */
  text: string;
  /** Latest AI message thought process of the stage (reasoning_content). */
  reasoning: string;
  /** Number of LLM calls seen on the messages channel. */
  calls: number;
  phase: LLMPhase;
  /** Authoritative usage from the stage_complete custom event. */
  usage?: TokenUsage;
  /** Live usage summed from the messages channel (shown until `usage` arrives). */
  liveUsage?: TokenUsage;
}

/**
 * Merge messages-channel buckets with custom-event milestones into the
 * per-stage view model. Stages with neither LLM messages nor LLM milestones
 * are omitted.
 */
export function mergeStageLLMData(
  buckets: Record<string, StageLLMStream>,
  milestones: Record<string, MilestoneEvent[]>,
  persistedUsage?: Record<string, TokenUsage>,
): Record<string, StageLLMData> {
  const result: Record<string, StageLLMData> = {};
  const stages = new Set([
    ...Object.keys(buckets),
    ...Object.keys(milestones),
    ...Object.keys(persistedUsage ?? {}),
  ]);
  stages.forEach((stage) => {
    const bucket = buckets[stage];
    const events = milestones[stage];
    const phase = deriveLLMPhase(events);
    // state 里持久化的 usage 最权威（接管已完成线程时 milestone 事件不可得）
    const usage = persistedUsage?.[stage] ?? finalStageUsage(events);
    if (!bucket && phase === 'idle' && !usage) return;
    result[stage] = {
      text: bucket?.text ?? '',
      reasoning: bucket?.reasoning ?? '',
      calls: bucket?.calls ?? 0,
      phase: usage && phase === 'idle' ? 'done' : phase,
      usage,
      liveUsage: bucket?.usage,
    };
  });
  return result;
}

/** Workflow-wide token usage: sum of every stage's final (or live) usage. */
export function totalWorkflowUsage(
  stages: Record<string, StageLLMData>,
): TokenUsage | undefined {
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let seen = false;
  Object.values(stages).forEach((s) => {
    const usage = s.usage ?? s.liveUsage;
    if (!usage) return;
    seen = true;
    input += usage.input_tokens ?? 0;
    output += usage.output_tokens ?? 0;
    reasoning += usage.reasoning_tokens ?? 0;
  });
  if (!seen) return undefined;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    ...(reasoning > 0 ? { reasoning_tokens: reasoning } : {}),
  };
}
