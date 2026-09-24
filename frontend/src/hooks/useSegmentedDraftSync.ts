import { useCallback, useEffect, useRef } from 'react';
import type { SegmentedProject } from '../types';
import type { SegmentedProjectStorage } from '../services/segmentedProjectStorage';
import {
  getDraft,
  putDraft,
  type ProjectDraftRecord,
} from '../services/segmentedDraftStore';
import { apiErrorCode, apiStaleServerUpdatedAt } from '../services/api';

const DEBOUNCE_MS = 1000;

// ── 409 自愈（第一层）默认参数 ──
/** 在途自写响应晚于 409 到达时的轮询间隔 */
const STALE_POLL_INTERVAL_MS = 250;
/** 等待在途自写响应登记的总窗口；耗尽即按真冲突上抛（第二层接手） */
const STALE_MAX_WAIT_MS = 1000;
/** 单次 flush 内自撞重试上限（首次 PUT 之外最多再试 3 次） */
const STALE_MAX_RETRIES = 3;
/** 已知服务端版本集合的每项目容量上限（防无界增长） */
const KNOWN_VERSIONS_CAP = 64;

export interface StaleRetryOptions {
  pollIntervalMs?: number;
  maxWaitMs?: number;
  maxRetries?: number;
}

export interface DraftSyncOptions {
  storage: SegmentedProjectStorage;
  /** Debounce delay; default 1000ms. Set 0 or low value in tests. */
  debounceMs?: number;
  /** 草稿成功写入后端后回调（用于同步"已落库章节集合"等派生状态）。 */
  onSaved?: (project: SegmentedProject) => void;
  /** 草稿写入后端失败时回调（真冲突等已耗尽自愈时才到达此处）。 */
  onSaveError?: (error: unknown) => void;
  /** 409 自愈参数（测试注入短窗口用）。 */
  staleRetry?: StaleRetryOptions;
}

/** ISO 时间戳比较：a 严格晚于 b；解析失败返回 false（安全方向：不动 base）。 */
function isLaterVersion(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta > tb;
}

type SelfWriteWaitResult = 'known' | 'superseded' | 'timeout';

export function useSegmentedDraftSync(projectId: string | null, options: DraftSyncOptions) {
  const { storage, debounceMs = DEBOUNCE_MS, onSaved, onSaveError, staleRetry } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // 冲突裁决期间挂起 autosave（pause → 弹窗 → resume）
  const pausedRef = useRef(false);
  // 已知服务端版本：本端发起的写（细粒度端点响应 / PUT 成功响应）产生的版本。
  // 409 报告的 server_updated_at ∈ 集合 ⟺ 服务端最后一次写是本端发起 ⟺ 假冲突。
  const knownVersionsRef = useRef<Map<string, Set<string>>>(new Map());
  // Stash projectId/storage in refs so the timer callback always reads current values
  const projectIdRef = useRef(projectId);
  const storageRef = useRef(storage);
  const onSavedRef = useRef(onSaved);
  const onSaveErrorRef = useRef(onSaveError);
  const staleRetryRef = useRef<Required<StaleRetryOptions>>({
    pollIntervalMs: staleRetry?.pollIntervalMs ?? STALE_POLL_INTERVAL_MS,
    maxWaitMs: staleRetry?.maxWaitMs ?? STALE_MAX_WAIT_MS,
    maxRetries: staleRetry?.maxRetries ?? STALE_MAX_RETRIES,
  });

  useEffect(() => {
    projectIdRef.current = projectId;
    storageRef.current = storage;
    onSavedRef.current = onSaved;
    onSaveErrorRef.current = onSaveError;
    staleRetryRef.current = {
      pollIntervalMs: staleRetry?.pollIntervalMs ?? STALE_POLL_INTERVAL_MS,
      maxWaitMs: staleRetry?.maxWaitMs ?? STALE_MAX_WAIT_MS,
      maxRetries: staleRetry?.maxRetries ?? STALE_MAX_RETRIES,
    };
  }, [projectId, storage, onSaved, onSaveError, staleRetry]);

  const registerKnownVersion = useCallback((pid: string, version: string) => {
    let set = knownVersionsRef.current.get(pid);
    if (!set) {
      set = new Set();
      knownVersionsRef.current.set(pid, set);
    }
    if (set.has(version)) return;
    set.add(version);
    // 超容量时按插入序（旧→新）淘汰，保留最近的
    if (set.size > KNOWN_VERSIONS_CAP) {
      let excess = set.size - KNOWN_VERSIONS_CAP;
      for (const v of set) {
        if (excess <= 0) break;
        set.delete(v);
        excess--;
      }
    }
  }, []);

  const isKnownVersion = useCallback((pid: string, version: string) => {
    return knownVersionsRef.current.get(pid)?.has(version) ?? false;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 等待在途自写响应把 serverAt 登记进已知集合（网络乱序：409 先到）。 */
  const waitForSelfWrite = useCallback(async (
    pid: string,
    serverAt: string,
    recUpdatedAt: string,
  ): Promise<SelfWriteWaitResult> => {
    const { pollIntervalMs, maxWaitMs } = staleRetryRef.current;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollIntervalMs));
      if (isKnownVersion(pid, serverAt)) return 'known';
      // 等待期间草稿被取代：放弃等待，交新 flush 接手
      const latest = await getDraft(pid);
      if (!latest || latest.updated_at !== recUpdatedAt) return 'superseded';
    }
    return 'timeout';
  }, [isKnownVersion]);

  // Flush reads the latest draft from the draft store and pushes it to the backend.
  const flush = useCallback(async (): Promise<void> => {
    if (pausedRef.current) return;
    const pid = projectIdRef.current;
    if (!pid) return;
    const rec0 = await getDraft(pid);
    if (!rec0 || !rec0.dirty) return;
    let rec = rec0;
    const { maxRetries } = staleRetryRef.current;
    try {
      let saved: SegmentedProject | undefined;
      let base = rec.base_updated_at;
      // ── 第一层：409 自愈循环 ──
      // 自撞（S ∈ 已知集合）→ 以 409 报告的服务端当前值为新 base 重试；
      // 在途自写响应晚到 → 短暂轮询等登记后重试；否则（真冲突）上抛给第二层。
      for (let attempt = 0; ; attempt++) {
        try {
          saved = await storageRef.current.saveProject(rec.draft, { base_updated_at: base });
          break;
        } catch (error) {
          if (apiErrorCode(error) !== 'stale_payload') throw error;
          // 草稿被更新的 markDirty 取代：本次失败由新 flush 接手，静默退出
          // （旧实现此处仍回调 onSaveError，会把新草稿冲掉——数据丢失放大器）。
          const latest = await getDraft(pid);
          if (!latest || latest.updated_at !== rec.updated_at) return;
          const serverAt = apiStaleServerUpdatedAt(error);
          if (!serverAt) throw error;
          if (!isKnownVersion(pid, serverAt)) {
            const wait = await waitForSelfWrite(pid, serverAt, rec.updated_at);
            if (wait === 'superseded') return;
            if (wait === 'timeout') throw error;
          }
          if (attempt >= maxRetries) throw error;
          // 重试必须带上草稿的最新内容：PUT 在途期间 refreshDraft / noteServerVersion
          // 可能已把细粒度写（段 PATCH、合成结果）并入草稿记录，沿用首次捕获的快照
          // 会把那些结果整包覆盖回旧值——后端整包 PUT 对已存在段是照写 text 的。
          const fresh = await getDraft(pid);
          if (!fresh || fresh.updated_at !== rec.updated_at) return;
          rec = fresh;
          base = serverAt;
          console.debug('[draftSync] stale_payload self-heal retry', { attempt: attempt + 1, serverAt });
        }
      }
      // 保存耗时期间若有更新的 markDirty 写入（记录 updated_at 已变），本份草稿
      // 已过期：直接返回，保留新草稿与 dirty 标记（新草稿的 flush 已由该次
      // markDirty 排程）。否则收尾 putDraft 会把新草稿整份覆盖成旧草稿，
      // 导致新状态的保存永远丢失（曾表现为"合成成功但音频 404"）。
      const latest = await getDraft(pid);
      if (!latest || latest.updated_at !== rec.updated_at) return;
      const nextBase = saved?.updated_at ?? rec.draft.updated_at;
      const next: ProjectDraftRecord = {
        ...rec,
        // 新 base 取服务端权威 updated_at（响应）；存储不支持返回值时回退草稿时间戳
        base_updated_at: nextBase,
        dirty: false,
        last_save_error: undefined,
        last_save_attempt_at: new Date().toISOString(),
      };
      await putDraft(next);
      dirtyRef.current = false;
      // 本端 PUT 产生的服务端版本入已知集合（自愈判定用）
      registerKnownVersion(pid, nextBase);
      onSavedRef.current?.(rec.draft);
    } catch (error: unknown) {
      // 与成功路径同理：仅当草稿记录仍是本份时才回写错误状态并回调，
      // 避免覆盖保存期间写入的更新草稿（其 dirty 与排程 flush 保留）。
      const latest = await getDraft(pid);
      if (latest && latest.updated_at === rec.updated_at) {
        const next: ProjectDraftRecord = {
          ...rec,
          dirty: true,
          last_save_error: error instanceof Error ? error.message : String(error),
          last_save_attempt_at: new Date().toISOString(),
        };
        await putDraft(next);
        onSaveErrorRef.current?.(error);
      }
      // 草稿被取代 → 静默：新 flush 接手，不回调错误（防 recover 冲掉新草稿）
    }
  }, [isKnownVersion, registerKnownVersion, waitForSelfWrite]);

  const schedule = useCallback(() => {
    clearTimer();
    if (!projectId) return;
    if (pausedRef.current) return;
    timerRef.current = setTimeout(() => {
      void flush();
    }, debounceMs);
  }, [clearTimer, projectId, debounceMs, flush]);

  const markDirty = useCallback(async (project: SegmentedProject) => {
    // 草稿 key 取"被写项目自己的 id"，不能用闭包里的 projectId：TTSSynthesis 的
    // project 初值是 scratchpad 项目，加载 effect 捕获的 draftSync 仍闭包着
    // '__scratchpad__' —— 用它当 key，真实项目的草稿永远不会建立，首次 markDirty
    // 只能得到 base_updated_at=null，整包 PUT 不带 base（后端按老客户端放行），
    // 乐观锁直接失效、陈旧快照可静默覆盖他人写入。
    if (!project.id) return;
    const now = new Date().toISOString();
    const existing = (await getDraft(project.id)) ?? null;
    const rec: ProjectDraftRecord = {
      project_id: project.id,
      draft: project,
      base_updated_at: existing?.base_updated_at ?? null,
      updated_at: now,
      dirty: true,
    };
    await putDraft(rec);
    dirtyRef.current = true;
    schedule();
  }, [schedule]);

  const adoptBackendVersion = useCallback(async (project: SegmentedProject) => {
    // key 同样取被写项目的 id（见 markDirty 注释）：加载期调用点闭包的是
    // scratchpad 的 projectId，用它会把草稿写到别的项目名下。
    if (!project.id) return;
    const rec: ProjectDraftRecord = {
      project_id: project.id,
      draft: project,
      base_updated_at: project.updated_at,
      updated_at: project.updated_at,
      dirty: false,
    };
    await putDraft(rec);
    dirtyRef.current = false;
    clearTimer();
  }, [clearTimer]);

  const noteServerVersion = useCallback(async (serverUpdatedAt: string) => {
    // 服务端被细粒度端点（合成/PATCH/adjust 等）推进后，把乐观锁 base 前移，
    // 避免下一次整包 PUT 因 base 过期被 409。不动 draft 内容（本地编辑仍在）。
    // 用 ref 而不是闭包 projectId：调用点可能持有加载期创建的旧回调，闭包值会是
    // scratchpad 的 id，导致登记与查草稿都落到别的项目名下（与 flush 保持一致）。
    const pid = projectIdRef.current;
    if (!pid) return;
    // 该版本由本端发起的写产生 → 登记进已知集合（409 自愈判定）
    registerKnownVersion(pid, serverUpdatedAt);
    const rec = await getDraft(pid);
    if (!rec) return;
    // 单调保护：乱序到达的旧响应（如乱序完成的 PATCH）不得把 base 回退，
    // 否则会制造本可避免的 409。
    if (rec.base_updated_at && !isLaterVersion(serverUpdatedAt, rec.base_updated_at)) return;
    if (rec.base_updated_at === serverUpdatedAt) return;
    await putDraft({ ...rec, base_updated_at: serverUpdatedAt });
  }, [registerKnownVersion]);

  const refreshDraft = useCallback(async (project: SegmentedProject) => {
    // touch=false 的变更（PATCH/结构端点已远端持久化）不触发 markDirty，
    // 但已有草稿（尤其 dirty 待冲刷的）内容必须随本地态刷新——否则冲刷时
    // 会把陈旧快照整包 PUT 回去，覆盖 PATCH 刚写入的字段（2026-08-27
    // dialogue-prosody e2e：kind 切换的 PATCH 被进入工作室时标记的
    // 陈旧草稿 PUT 覆盖回 narration）。
    // 只更新已有记录：无记录时不创建（初始加载等场景不制造草稿）。
    if (!project.id) return;
    const rec = await getDraft(project.id);
    if (!rec) return;
    await putDraft({ ...rec, draft: project });
  }, []);

  /** 暂停 autosave：挂起 flush 排程与执行（冲突裁决期间防 409 循环）。 */
  const pause = useCallback(() => {
    pausedRef.current = true;
    clearTimer();
  }, [clearTimer]);

  /** 恢复 autosave：若当前草稿仍 dirty 则立即补排程。 */
  const resume = useCallback(() => {
    pausedRef.current = false;
    if (dirtyRef.current) schedule();
  }, [schedule]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { markDirty, flush, adoptBackendVersion, noteServerVersion, refreshDraft, pause, resume };
}
