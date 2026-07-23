/**
 * 指定节点重跑（fork）：从 LangGraph 历史 checkpoints 中选取恢复点。
 */
import { NODE_STATE_KEYS } from './contracts';

/** threads.getHistory 返回项的最小结构（仅依赖这两字段，便于测试与类型解耦）。 */
export interface HistoryCheckpoint {
  checkpoint: { checkpoint_id: string };
  values: Record<string, unknown>;
}

/**
 * 选取「从 nodeId 重跑」的 checkpoint。
 *
 * history 按时间倒序（最新在前）。恢复点的语义是「该节点尚未执行、即将
 * 执行」的状态——从它恢复，该节点会重新执行（而非执行它的后继节点）。
 * 因此找 values 中该节点完成态 key（NODE_STATE_KEYS）首次全部就绪的
 * checkpoint，再取它之前（更旧）的那个：即该节点首次执行前的状态，
 * 带着上游结果重跑本节点。若该节点在最早记录点就已完成（无更旧的
 * checkpoint），返回最早记录点（相当于从头跑）。
 *
 * 节点从未完成（无满足条件的 checkpoint）或节点无完成态 key 时返回 null。
 */
export function pickForkCheckpoint(
  history: HistoryCheckpoint[],
  nodeId: string,
): string | null {
  const keys = NODE_STATE_KEYS[nodeId] ?? [];
  if (keys.length === 0 || history.length === 0) return null;
  // 从最旧（数组末尾）向最新扫描，找「首次就绪」的位置 j
  for (let j = history.length - 1; j >= 0; j -= 1) {
    const values = history[j]?.values ?? {};
    if (keys.every((k) => values[k] != null)) {
      // j+1 是更旧的 checkpoint（节点执行前）；不存在则 j 即最早记录点
      const preExec = history[j + 1] ?? history[j];
      return preExec.checkpoint.checkpoint_id;
    }
  }
  return null;
}
