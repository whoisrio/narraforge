/**
 * Workflow 线程解析：接管活跃线程 / 自动清理僵尸线程 / 创建新线程。
 *
 * 背景：langgraph dev（in-mem）会在 SSE 客户端断连时取消执行中的 run，
 * 留下 status='interrupted' 但 tasks[].interrupts 为空的「僵尸线程」——
 * 它没有可恢复的 interrupt 负载，接管后 UI 会卡死在无审批面板的死状态。
 * 因此对 interrupted 候选线程逐个校验，僵尸线程直接删除后重建。
 */
import type { Client } from '@langchain/langgraph-sdk';

// 注：必须为 type 别名而非 interface —— 对象字面量类型带隐式索引签名，
// 才能赋给 langgraph-sdk 的 Metadata（Record 型）。
export type WorkflowThreadMetadata = {
  project_id: string;
  project_name: string;
  kind: string;
};

/** interrupted 线程是否有待处理的人工审批（可 resume 的 interrupt 负载）。 */
export async function hasPendingInterrupt(
  client: Client,
  threadId: string,
): Promise<boolean> {
  const state = await client.threads.getState(threadId);
  return (state.tasks ?? []).some((task) => (task.interrupts?.length ?? 0) > 0);
}

/**
 * 按优先级解析工作流线程：
 * 1. busy（运行中）→ 直接接管；
 * 2. interrupted 且有审批负载 → 接管等待人工处理；
 * 3. interrupted 但无负载（僵尸）→ 自动删除，继续看下一个候选；
 * 4. 无可用线程 → 创建新线程。
 *
 * 返回可接管的 thread_id（新建或现有）。
 */
export async function resolveWorkflowThread(
  client: Client,
  metadata: WorkflowThreadMetadata,
): Promise<string> {
  const existing = await client.threads.search({
    metadata: { project_id: metadata.project_id, kind: metadata.kind },
    limit: 50,
  });
  const active = existing.filter(
    (t) => t.status === 'busy' || t.status === 'interrupted',
  );
  for (const t of active) {
    if (t.status === 'busy') return t.thread_id;
    if (await hasPendingInterrupt(client, t.thread_id)) return t.thread_id;
    await client.threads.delete(t.thread_id);
  }
  const thread = await client.threads.create({ metadata });
  return thread.thread_id;
}
