/**
 * 下载推荐弹窗：页面停留期间每下载 N 次弹一次确认。
 * 纯内存计数——刷新页面即归零（不持久化到 sessionStorage）。
 */

/** 每下载多少次弹一次确认 */
export const DOWNLOAD_UPSELL_INTERVAL = 5;

let downloadCount = 0;

/**
 * 记录一次下载点击；返回本次是否应先弹出确认（第 5、10、15… 次返回 true）。
 */
export function recordDownloadAndCheckUpsell(): boolean {
  downloadCount += 1;
  return downloadCount % DOWNLOAD_UPSELL_INTERVAL === 0;
}

/** 测试专用：重置计数（运行时的"归零"即页面刷新，无需业务代码调用）。 */
export function resetDownloadUpsellCounter(): void {
  downloadCount = 0;
}
