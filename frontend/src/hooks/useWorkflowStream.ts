import { useEffect, useRef } from 'react';
import type { WorkflowSSEEvent } from '../types';

interface WorkflowCallbacks {
  onStageStart?: (stage: string) => void;
  onProgress?: (stage: string, chunk: unknown) => void;
  onStageComplete?: (stage: string, output: unknown) => void;
  onInterrupt?: (payload: unknown) => void;
  onError?: (stage: string, error: string) => void;
  onComplete?: (runId: string, results: unknown) => void;
}

/**
 * 解析 SSE 文本为事件数组
 */
export function parseSSE(text: string): WorkflowSSEEvent[] {
  const events: WorkflowSSEEvent[] = [];
  const lines = text.split('\n');

  let currentEvent = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      const data = line.slice(6);
      try {
        events.push({
          type: currentEvent as WorkflowSSEEvent['type'],
          data: JSON.parse(data),
        });
      } catch {
        // 忽略解析错误
      }
    }
  }

  return events;
}

/**
 * 订阅工作流 SSE 流
 */
export function useWorkflowStream(
  projectId: string,
  runId: string | null,
  callbacks: WorkflowCallbacks,
) {
  const callbacksRef = useRef(callbacks);

  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    if (!runId) return;

    const controller = new AbortController();

    async function subscribe() {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/workflow/${runId}/stream`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          console.error('SSE connection failed:', response.status);
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = parseSSE(buffer);
          buffer = '';

          for (const event of events) {
            const cb = callbacksRef.current;
            switch (event.type) {
              case 'stage_start':
                cb.onStageStart?.(event.data.stage as string);
                break;
              case 'stage_progress':
                cb.onProgress?.(event.data.stage as string, event.data.chunk);
                break;
              case 'stage_complete':
                cb.onStageComplete?.(event.data.stage as string, event.data.output);
                break;
              case 'interrupt':
                cb.onInterrupt?.(event.data.payload);
                break;
              case 'error':
                cb.onError?.(event.data.stage as string, event.data.error as string);
                break;
              case 'workflow_complete':
                cb.onComplete?.(event.data.run_id as string, event.data.results);
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('SSE subscription error:', err);
        }
      }
    }

    subscribe();

    return () => controller.abort();
  }, [projectId, runId]);
}
