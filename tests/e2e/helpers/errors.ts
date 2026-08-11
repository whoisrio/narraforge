/**
 * Console error collection helper for E2E tests.
 */
import type { Page } from '@playwright/test';

/** Known React warnings that should not be treated as test failures. */
const IGNORED_WARNINGS = [
  'An empty string ("") was passed to the',
];

/** Attach a console error listener and return the collected errors array. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  // e2e 不依赖外网字体：拦截 Google Fonts 请求并返回空 CSS。
  // 外网字体在国内网络下间歇性 404，"Failed to load resource" 控制台错误
  // 会随机命中某个用例的 errors 断言造成误失败；空 CSS 后不会再发起 woff2 请求。
  void page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter out known React warnings that are promoted to errors in dev mode
      if (IGNORED_WARNINGS.some(w => text.includes(w))) return;
      errors.push(text);
    }
  });
  return errors;
}
