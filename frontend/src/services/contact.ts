/**
 * 联系管理员邮箱（构建期 `VITE_ADMIN_EMAIL` 注入）。
 * 未配置时返回 undefined，各入口（Landing 页脚 / Try 页 / 工作区侧栏）不展示。
 * 函数式读取而非模块级常量：便于测试用 vi.stubEnv 按用例切换。
 */
export function getAdminContactEmail(): string | undefined {
  const email = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.trim();
  return email || undefined;
}
