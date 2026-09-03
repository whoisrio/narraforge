# 全局加载反馈（Loading Feedback）设计文档

日期：2026-09-02
分支：`feat/global-loading-feedback`
状态：已与用户确认（方案与范围）

## 1. 背景与问题

生产环境（backend 存储模式）下，前后端交互的读操作明显耗时，但 UI 没有任何加载反馈：

- **P0 — 误导性空状态**：`App.tsx` 加载项目列表期间，`ProjectHub` 直接渲染"没有项目"的空状态，用户以为数据丢了。
- **P0 — 无反馈的打开项目**：`TTSSynthesis` 初始加载（`listProjects` + `getProject`）期间，编辑器底层渲染的是草稿项目（scratchpad），没有任何加载提示。
- **数据竞争窗口**：加载窗口期内用户可交互，基于草稿/旧状态发出 patch/合成请求；代码里已有 `initialLoadDoneRef` 暂停自动保存的守卫，正说明该风险真实存在。
  模态阻断同时是 UX 与正确性修复。

## 2. 目标与非目标

### 目标

- 用户主动触发、UI 强依赖的读操作：模态阻断 + 具体文案。
- 修复项目列表加载中的误导性空状态。
- 挂死请求有逃生舱（安抚文案 + 重试）。

### 非目标

- 后台静默请求（sync-status 轮询、voice 轮询、capabilities/storage mode 探测）不加模态——全局自动拦截方案明确否决。
- 已有局部反馈的操作（章节拆分 modal、单段合成的行内状态）不重复反馈。
- 不做全局 axios 拦截器自动加载态。

## 3. 架构

新增基础设施，仿照现有 `ToastProvider` / `ConfirmProvider` 模式：

```
src/components/ui/
  loadingContext.ts       # Context + 类型定义
  LoadingProvider.tsx     # 任务栈状态管理（React state）
  LoadingModal.tsx        # 模态 UI（portal 到 body）
  LoadingModal.module.css
  useLoading.ts           # 对外 hook
```

- `App.tsx` 根部（`ToastProvider` 内侧）挂 `LoadingProvider`。
- 模态 portal 到 body 渲染在最顶层；toast z-index 保持更高（后台事件的错误提示不能被模态盖住）。
- spinner 用 CSS module 自带 keyframes；不复用旧 `ui/Loading.tsx`（它每次挂载向 `document.head` 注入 style 标签）。

## 4. 核心 API

```ts
interface LoadingRunOpts {
  /** 模态延迟出现阈值，默认 250ms；快速完成的操作（本地 IndexedDB）不闪模态 */
  delayMs?: number;
  /** 是否提供"重试"按钮；仅幂等读操作开启 */
  retryable?: boolean;
}

const { run } = useLoading();
run<T>(message: string, fn: (ctx: { signal: AbortSignal }) => Promise<T>, opts?): Promise<T>
```

### 任务栈语义

- 模态显示**栈顶**任务的 message。
- **嵌套调用不闪屏**：打开项目场景外层 `run('正在打开项目…')` 包住整个序列，内层 `run('正在获取项目列表…')`；内层完成后栈顶自动回到外层文案，模态全程不消失。
- 出现延迟只在"栈从空到非空"时生效。

### 错误语义

- `fn` 抛错 → 任务出栈 + 原样 rethrow；调用点现有 `catch → toast.error` 路径不变。

### signal 透传链

`run` 的 `ctx.signal` → 调用点 → `projectStorage.getProject(id, { signal })` → `segmentedProjectApi` → axios（原生支持）。
只给本次范围内的方法加可选 `signal` 参数，不全局铺开。

## 5. 模态 UI 规范

- 全屏遮罩：半透明黑 + `backdrop-filter: blur(2px)`；居中卡片：spinner + message。
- **不可关闭**：无关闭按钮、点遮罩无效（底层请求不可取消，假关闭比等待更糟）。
- 10s：追加"耗时较长，请稍候… 已等待 Ns"（每秒刷新）。
- 30s 且 `retryable`：出现"重试"按钮 → `abort()` → 原 promise 以 AbortError 拒绝 → `run` 内部换新 controller 重跑 `fn`（读操作幂等）；循环直到成功或真正报错。
- 无障碍：`role="dialog"` + `aria-modal` + `aria-busy`；背景容器加 `inert`（React 19 原生支持），键盘也切不出去。

## 6. 接入点清单

| # | 场景 | 调用点 | 文案 |
|---|---|---|---|
| 1 | 项目列表首次加载 | `App.tsx` 初始 effect；同时给 `ProjectHub` 加 `loading` prop，加载中显示骨架卡片 | 正在获取项目列表… |
| 2 | 打开项目进编辑器 | `TTSSynthesis` 初始加载 effect，嵌套 run 细分两段文案，`retryable: true` | 正在获取项目列表… → 正在打开项目 {name}… |
| 3 | 操作后整项目刷新 | `reloadProjectData`（4 处调用 + `onProjectChanged` 回调） | 正在同步项目数据… |
| 4 | 旁白稿读取 | `ProjectLibrary.tsx` 的 `getProject` | 正在加载旁白稿… |
| 5 | 批量导出 | `exportAllChapters`；backend 模式 `exportProject`；前端模式本地打包同样包装 | 正在批量导出章节… / 正在导出项目… |

明确不动的：sync-status 轮询、voice 轮询、capabilities/storage mode 探测；章节拆分等已有局部反馈的操作；单段合成（响应直更，无整项目刷新）。

## 7. i18n

zh-CN / en-US 双语，收敛在根级 `loading.*` 命名空间（**不是** `common.loading.*`）：

`projectList` / `openProject`（{name}）/ `reloadProject` / `narrationScript` / `exportAll` / `exportProject` / `slowHint` / `retry` / `waitSeconds`（{sec}）。

> 命名空间取舍说明：`common.loading` 在当前 i18n 中已是一个**字符串键**（`'加载中...'`，被 VoiceClone / ModelConfig / 各 TTS 面板等 9 处当作文案使用）。若按早期草案塞进 `common.loading.*`，会把这个字符串键变成对象，导致上述 9 处 `t('common.loading')` 调用全部失效。因此实现采用根级 `loading.*`，与既有 `common.loading` 字符串键互不干扰。接入点调用统一用 `t('loading.<key>')`。

## 8. 测试策略（TDD）

- **单元**：`LoadingProvider` 状态机（入栈/出栈/栈顶文案切换/延迟显示/abort 重试循环）——vitest + fake timers。
- **组件**：`LoadingModal` 渲染断言（文案、aria 属性、10s 安抚出现、30s 重试按钮出现、inert 生效）。
- **集成**：`ProjectHub` `loading` 骨架渲染；各调用点 mock 断言 run 包装正确。
- **E2E**：Playwright CDP 网络节流（慢 3G）→ 打开项目 → 断言模态出现且文案正确 → 数据到达后模态消失、编辑器可交互。落 `tests/e2e/` 现有约定。
- **文档**：`docs/feature-spec.md` 增补"全局加载反馈"小节；`docs/frontend-audit.md` 记录误导性空状态修复。
