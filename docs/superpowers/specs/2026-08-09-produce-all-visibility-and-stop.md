# 一键制作全本(produce-all):跨 section 进度可见 + 可停止

Date: 2026-08-09
Status: Design (pending user review)
Owner: frontend

## 背景

`handleProduceAll`(`frontend/src/pages/TTSSynthesis.tsx:1312`)是"一键制作全本"流程:
补切无段章节 → 拉最新项目态收集目标段 → 顺序合成每段。

它的进度状态只有一个页面级 boolean `generating`(`:134`),
Phase 3 是纯顺序循环 `for (const segId of targets) { await handleRegenerateRef.current(segId); }`(`:1347-1350`),
没有"第几段/共几段"的粒度,也没有取消机制。

`generating` 唯一的 UI 体现是 `produceAllDisabled={generating}`(`:1702`)禁用按钮,
以及 `VoiceStudioLayout` transport bar 里**当前章节**的 `generatedCount/segmentCount` 进度条(非全本)。

ProjectShell 是项目内所有 section(`overview/library/studio/voices/settings`)共用的壳,
其 contextBar(`ProjectShell.tsx:313`)永远可见,目前只放面包屑 + inlineMeta。

## 问题

1. **跨 section 不可见**:
   从 `studio` 切到 `library/overview/voices/settings` 后,TTSSynthesis 不 unmount、produce-all 仍在后台跑,
   但 UI 上没有任何指示告诉用户"全本合成进行中,3/120 段"。
   用户切到 library 看章节列表,完全不知道后台在合成。

2. **粒度不足**:
   即使停在 studio,也只有 boolean,看不到"3/120 段、当前第 2 章"。
   transport bar 那条进度是当前章节的,produce-all 是跨章节的,对不上。

3. **单段可并发触发**:
   `handleRegenerate`(`:911`)没有 `if (generating) return` 守卫。
   produce-all 跑时,用户点单段生成按钮(`:1178`)会并发触发,共享 `dispatch` 产生状态竞争。
   (batch `:1235`、bulk `:781`、produceAll `:1313` 三处入口已有 `if (generating) return`。)

4. **不可停止**:
   produce-all 循环无退出条件,一旦开始必须跑完全部目标段才能停。

## 目标

- produce-all 运行时,在项目内任意 section 都能看到进度(已完成/总数、当前章节)。
- produce-all 运行时,禁止在 studio 里重新触发任何合成(单段 / batch / bulk / 再次全本)。
- 用户可中途停止 produce-all(段间停止:当前段跑完即停)。

## 非目标

- 不处理切全局 nav(voice-design/subtitles/settings)导致 TTSSynthesis unmount 的问题。
  该问题(后台 loop 脱离组件上下文)是更深的架构缺陷,单独立项。
  本设计只覆盖项目内 section 切换 + 切章节场景。
- 不做段内立即中断(不引入 AbortSignal 到 synth API 层)。
- 不给 batch / bulk 做跨 section 进度可见(它们是单章、短任务,studio transport bar 已够)。

## 设计

### 1. 状态模型

保留 `generating`(boolean)给所有"批量类"合成共享,新增 `produceAllRun` 专门描述全本任务:

```ts
type ProduceAllRun = {
  running: boolean;
  mode: 'unsynthesized' | 'all';
  total: number;          // Phase 2 收集到的目标段数
  done: number;           // 已合成完成(含成功与失败)的段数
  currentSegmentId?: string;
  currentChapterName?: string;
  startedAt: number;      // 用于 toast 文案 / 防呆
} | null;
```

- `generating === true` 当且仅当 batch / bulk / produceAll 任一在跑(语义不变,继续用于禁用按钮)。
- `produceAllRun` 仅 produceAll 时非 null。
- 停止或完成后置 `null`。

### 2. 进度可见性:ProjectShell contextBar 右侧常驻

ProjectShell 是所有 section 共用壳,contextBar 永远可见,是天然的跨 section 锚点。

新增 props:

```ts
interface ProjectShellProps {
  // ...existing
  produceAllRun?: ProduceAllRun | null;
  onStopProduceAll?: () => void;
}
```

当 `produceAllRun` 非空且 `running` 时,在 breadcrumbs 行右侧渲染紧凑进度组件:

```
[■■■■■■□□□□□□] 合成中 12/120 · 第2章「xxx」  [■ 停止]
```

- 进度条宽度 = `done / total`。
- "停止"按钮调 `onStopProduceAll`。
- 样式复用现有 design tokens,不引入浮层(避免遮挡内容、避免与 transport bar 冲突)。

TTSSynthesis 传:
`<ProjectShell produceAllRun={produceAllRun} onStopProduceAll={handleStopProduceAll} ... />`

VoiceStudio 里 `produceAllDisabled={generating}` 保持不变(已能正确禁用)。

### 3. 防重复触发:统一守卫 + internal 旗标

核心陷阱:produce-all Phase 3 循环本身反复调 `handleRegenerateRef.current(segId)`,
不能在 `handleRegenerate` 开头无差别加 `if (generating) return`,会把自己的循环也拦死。

方案:`handleRegenerate(id, opts?)` 的 `opts` 增加 `internal?: boolean`。

```ts
const handleRegenerate = useCallback(async (id: string, opts?: { force?: boolean; internal?: boolean }) => {
  if (generating && !opts?.internal) {
    showToast(t('tts.produceAllInProgress'), 'warning');  // 新增 i18n key
    return;
  }
  // ...existing
}, [...]);
```

守卫用 `generating`(而非 `produceAllRun?.running`):
任何"多段顺序合成"在跑时(batch/bulk/produceAll)都禁止单段手动触发,语义最安全。

调用点改造(已知 3 处,实现时 audit 全文件确认无遗漏):

| 调用点 | 行 | 改造 |
|---|---|---|
| 单段按钮入口 | `:1178` | 不传 internal,吃守卫(被拦时 toast 提示) |
| batch `doRegenerateAll` 循环 | `:1300` | 传 `{ internal: true }` |
| produceAll Phase 3 循环 | `:1350` | 传 `{ internal: true }` |

batch / bulk / produceAll 三处入口原有的 `if (generating) return` 保持不变(防它们彼此并发)。

### 4. 停止:段间停止

新增 `produceAllAbortRef = useRef(false)`。

Phase 3 循环改造:

```ts
produceAllAbortRef.current = false;
for (const segId of targets) {
  if (produceAllAbortRef.current) break;
  setProduceAllRun(prev => prev ? { ...prev, currentSegmentId: segId, currentChapterName: chapterNameOf(segId) } : prev);
  await handleRegenerateRef.current(segId, { internal: true });
  setProduceAllRun(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
}
```

`handleStopProduceAll`:

```ts
const handleStopProduceAll = useCallback(() => {
  produceAllAbortRef.current = true;
}, []);
```

`handleProduceAll` 的 finally 分支根据是否 aborted 给不同 toast:

```ts
finally {
  setGenerating(false);
  const aborted = produceAllAbortRef.current;
  setProduceAllRun(null);
  await reloadProjectData();
  if (aborted) {
    showToast(t('tts.produceAllStopped', { done, total }), 'info');  // 已停止,完成 X/Y
  } else {
    showToast(t('tts.allGenerationComplete'));
  }
}
```

停止语义:
- 当前正在合成的段会跑完(单段几秒),下一段不再开始。
- 已合成的段保留;未合成的段保持原 `idle/failed`(后端权威态由 reload 拉回)。
- `produceAllRun` 置 null,contextBar 进度条消失。
- `generating` 置 false,按钮恢复可用。

Phase 1(补切)、Phase 2(收集目标)通常很快,停止只作用于 Phase 3。
若 Phase 1 split 循环也想可停,在其循环里同样检查 flag(可选,首版不做)。

## 影响文件

- `frontend/src/pages/TTSSynthesis.tsx` — 状态模型、守卫、停止逻辑、传 props。
- `frontend/src/components/ProjectShell/ProjectShell.tsx` — contextBar 进度组件 + 新 props。
- `frontend/src/components/ProjectShell/ProjectShell.module.css` — 进度组件样式。
- `frontend/src/services/produceAll.ts` — 若把"chapterNameOf / 进度计算"抽纯函数则改这里(见测试策略)。
- `frontend/src/i18n/zh-CN.ts` / `en-US.ts` — 新增 `tts.produceAllInProgress`、`tts.produceAllStopped` 等 key。

## 测试策略(TDD)

项目强制 TDD,先写测试再实现。

### 单元测试

- `produceAll.test.ts`:若抽纯函数(如 `progressPercent(done, total)`、`describeCurrent(targets, done)`),补对应用例。
- `ProjectShell.test.tsx`:新增用例 — `produceAllRun` 非空时渲染进度条 + 停止按钮;`onStopProduceAll` 点击触发;`produceAllRun` null 时不渲染。
- TTSSynthesis 的守卫逻辑:单段入口在 `generating` 时被拦且 toast,`internal: true` 时不拦。可抽 `shouldBlockManualSynth(generating, internal)` 纯函数测,或通过组件行为测。

### E2E 测试

`tests/e2e/specs/produce-all.spec.ts` 已存在,新增场景:

1. 触发 produce-all → 切到 library section → contextBar 仍显示进度且递增 → 切回 studio 进度一致。
2. produce-all 运行中 → 点单段生成按钮 → 被禁用或 toast,不触发新合成。
3. produce-all 运行中 → 点停止 → 当前段完成后停止 → toast 提示完成数 → 已合成段保留、未合成段 idle。

E2E 须验证全链路:前端 contextBar 显示 ↔ 段状态(ready/idle)↔ 后端音频文件存在性,符合项目 E2E 规范。

## 边界与错误处理

- **停止后立即重开**:停止把 `generating` 置 false,用户可立即重新触发 produce-all。
  新 run 会重新走 Phase 1/2 收集目标(此时未合成段仍是 idle),`selectProduceAllSegments` 自然只选未完成的。
- **单段合成失败**:Phase 3 循环里单段失败由 `handleRegenerate` 内部 catch(GENERATE_FAIL),不中断循环。
  `done` 仍 +1(失败也算"处理过"),进度条继续推进。最终 toast 若有失败段,提示部分失败(沿用现有 `tts.partialGenerationFailed` 语义)。
- **停止时正好在 Phase 1/2**:首版不处理,Phase 1/2 不可中断(很快)。
- **produceAllRun 与 generating 一致性**:`setGenerating(true)` 与 `setProduceAllRun({...running:true})` 在 handleProduceAll 开头同时设;finally 同时清。保证不会出现 `generating=false` 但 `produceAllRun.running=true` 的不一致态。

## 开放问题

无(两个关键决策已定:段间停止 + contextBar 常驻)。
