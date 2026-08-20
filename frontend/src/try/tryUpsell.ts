/**
 * 下载推荐弹窗：每会话（sessionStorage）只展示一次。
 */
const UPSELL_SHOWN_KEY = 'try_download_upsell_shown';

export function shouldShowDownloadUpsell(): boolean {
  return sessionStorage.getItem(UPSELL_SHOWN_KEY) !== '1';
}

export function markDownloadUpsellShown(): void {
  sessionStorage.setItem(UPSELL_SHOWN_KEY, '1');
}
