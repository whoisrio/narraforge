import { useCallback, useEffect, useRef } from 'react';
import {
  segmentedProjectApi,
  type ChapterPatchBody,
  type ProjectPatchBody,
} from '../services/api';

const DEFAULT_DEBOUNCE_MS = 700;

export interface SegmentedEntitySyncOptions {
  projectId: string;
  /** backend 存储模式且非 scratchpad 时为 true */
  enabled: boolean;
  debounceMs?: number;
  /** 任一实体写成功后的服务端项目 updated_at */
  onServerVersion?: (version: string) => void;
  onError?: (error: unknown) => void;
}

interface PendingPatch<T> {
  body: T;
  projectId: string;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * 项目/章节/文档的细粒度自动保存。
 *
 * 每个实体独立防抖、独立串行链：同一实体前一次请求在途时，后续写必须等它完成，
 * 避免 PATCH 响应乱序把旧字段覆盖到新值上。卸载/切换项目时 flush 尾部输入。
 */
export function useSegmentedEntitySync(options: SegmentedEntitySyncOptions) {
  const { projectId, enabled, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  const projectRef = useRef<PendingPatch<ProjectPatchBody> | null>(null);
  const chaptersRef = useRef(new Map<string, PendingPatch<ChapterPatchBody>>());
  const documentsRef = useRef(new Map<'source_document' | 'narration_script', PendingPatch<string>>());
  const chainsRef = useRef(new Map<string, Promise<void>>());
  const projectIdRef = useRef(projectId);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);

  const runSerial = useCallback((key: string, task: () => Promise<void>) => {
    const previous = chainsRef.current.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const settled = next.finally(() => {
      if (chainsRef.current.get(key) === settled) chainsRef.current.delete(key);
    });
    chainsRef.current.set(key, settled);
  }, []);

  const reportVersion = useCallback((version: string | null | undefined) => {
    if (version) optionsRef.current.onServerVersion?.(version);
  }, []);

  const reportError = useCallback((error: unknown) => {
    optionsRef.current.onError?.(error);
  }, []);

  const sendProject = useCallback(() => {
    const pending = projectRef.current;
    if (!pending) return;
    projectRef.current = null;
    if (pending.timer) clearTimeout(pending.timer);
    const body = pending.body;
    runSerial('project', async () => {
      try {
        const resp = await segmentedProjectApi.patchProject(pending.projectId, body);
        if (pending.projectId === projectIdRef.current) reportVersion(resp.updated_at);
      } catch (error) {
        reportError(error);
      }
    });
  }, [reportError, reportVersion, runSerial]);

  const sendChapter = useCallback((chapterId: string) => {
    const pending = chaptersRef.current.get(chapterId);
    if (!pending) return;
    chaptersRef.current.delete(chapterId);
    if (pending.timer) clearTimeout(pending.timer);
    const body = pending.body;
    runSerial(`chapter:${chapterId}`, async () => {
      try {
        const resp = await segmentedProjectApi.patchChapter(pending.projectId, chapterId, body);
        if (pending.projectId === projectIdRef.current) reportVersion(resp.project_updated_at);
      } catch (error) {
        reportError(error);
      }
    });
  }, [reportError, reportVersion, runSerial]);

  const sendDocument = useCallback((kind: 'source_document' | 'narration_script') => {
    const pending = documentsRef.current.get(kind);
    if (!pending) return;
    documentsRef.current.delete(kind);
    if (pending.timer) clearTimeout(pending.timer);
    runSerial(`document:${kind}`, async () => {
      try {
        const resp = kind === 'source_document'
          ? await segmentedProjectApi.putSourceDocument(pending.projectId, pending.body)
          : await segmentedProjectApi.putNarrationScript(pending.projectId, pending.body);
        if (pending.projectId === projectIdRef.current) reportVersion(resp.project_updated_at);
      } catch (error) {
        reportError(error);
      }
    });
  }, [reportError, reportVersion, runSerial]);

  const queueProject = useCallback((patch: ProjectPatchBody) => {
    if (!enabled) return;
    const existing = projectRef.current;
    if (existing?.timer) clearTimeout(existing.timer);
    projectRef.current = {
      body: { ...(existing?.body ?? {}), ...patch },
      projectId: projectIdRef.current,
      timer: null,
    };
    const timer = setTimeout(() => sendProject(), debounceMs);
    projectRef.current.timer = timer;
  }, [debounceMs, enabled, sendProject]);

  const queueChapter = useCallback((chapterId: string, patch: ChapterPatchBody) => {
    if (!enabled) return;
    const existing = chaptersRef.current.get(chapterId);
    if (existing?.timer) clearTimeout(existing.timer);
    const entry: PendingPatch<ChapterPatchBody> = {
      body: { ...(existing?.body ?? {}), ...patch },
      projectId: projectIdRef.current,
      timer: null,
    };
    chaptersRef.current.set(chapterId, entry);
    entry.timer = setTimeout(() => sendChapter(chapterId), debounceMs);
  }, [debounceMs, enabled, sendChapter]);

  const queueDocument = useCallback((
    document: 'source_document' | 'narration_script',
    text: string,
  ) => {
    if (!enabled) return;
    const existing = documentsRef.current.get(document);
    if (existing?.timer) clearTimeout(existing.timer);
    const entry: PendingPatch<string> = { body: text, projectId: projectIdRef.current, timer: null };
    documentsRef.current.set(document, entry);
    entry.timer = setTimeout(() => sendDocument(document), debounceMs);
  }, [debounceMs, enabled, sendDocument]);

  const cancelProject = useCallback(() => {
    if (projectRef.current?.timer) clearTimeout(projectRef.current.timer);
    projectRef.current = null;
  }, []);

  const cancelChapter = useCallback((chapterId: string) => {
    const pending = chaptersRef.current.get(chapterId);
    if (pending?.timer) clearTimeout(pending.timer);
    chaptersRef.current.delete(chapterId);
  }, []);

  const flushAll = useCallback(async () => {
    for (const key of [...chaptersRef.current.keys()]) sendChapter(key);
    for (const key of [...documentsRef.current.keys()]) sendDocument(key);
    sendProject();
    await Promise.all([...chainsRef.current.values()]);
  }, [sendChapter, sendDocument, sendProject]);

  useEffect(() => () => {
    void flushAll();
  }, [flushAll]);

  return {
    queueProject,
    queueChapter,
    queueDocument,
    cancelProject,
    cancelChapter,
    flushAll,
  };
}
