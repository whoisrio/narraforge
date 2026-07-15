# NarraForge UI 一致性 & i18n 改进方案

**项目**: NarraForge  
**审查日期**: 2026-06-29  
**审查范围**: 前端 React 应用 (frontend/src)

---

## 📋 执行摘要

经过全面审查，NarraForge 项目存在以下主要问题：

1. **i18n 支持不完整** - 虽已建立 i18n 基础设施，但大量组件仍包含硬编码中文字符串
2. **UI 样式方案不一致** - 组件混用 CSS Modules、Inline Styles，缺乏统一的设计系统应用
3. **设计 Token 使用不完整** - 已定义的设计 Token 未在组件中完全应用
4. **交互模式不一致** - 类似组件的交互行为、状态管理不统一

---

## 🌐 i18n 问题详细分析

### 当前 i18n 基础设施状态

✅ **已实现**:
- `/src/i18n/index.ts` - 翻译函数 `createTranslator`, `t`
- `/src/i18n/zh-CN.ts` - 中文翻译文件
- `/src/i18n/en-US.ts` - 英文翻译文件
- 类型系统 `Locale`, `TranslationKey`, `Messages`

❌ **存在问题**:

#### 1. 硬编码中文字符串 (严重)

以下文件和行号包含未国际化的硬编码中文：

**`App.tsx`** (严重影响):
```typescript
// 第 29-30 行 - SettingsSelect 组件
<option value="backend">后端存储</option>
<option value="frontend">浏览器存储</option>

// 第 102 行 - 项目名称默认值
project.name = name || `新项目 ${projects.length + 1}`;

// 第 114 行 - 删除确认对话框
if (!window.confirm(`确定删除项目「${targetName}」？\n此操作不可撤销，所有章节和音频将一并删除。`)) return;
```

**`VoiceClone.tsx`** (严重影响):
```typescript
// 第 41-43 行 - inputMethodLabel 函数
if (method === 'record') return '录制';
if (method === 'upload') return '上传';
if (method === 'url') return 'URL';

// 第 114 行 - 同步成功消息
setSyncMessage({ type: 'success', text: result.message || '同步完成' });

// 第 118 行 - 同步失败消息
setSyncMessage({ type: 'error', text: err instanceof Error ? err.message : '同步失败' });

// 第 136 行 - 注释
// 编辑模式：克隆成功后删除旧声音
```

**`AppShell.tsx`** (中等影响):
```typescript
// 第 81 行
aria-label={collapsed ? '展开导航' : '收起导航'}

// 第 84-85 行
{collapsed ? '›' : '‹'}
{!collapsed && <span>收起</span>}
```

**`TTSSynthesis.tsx`** (中等影响):
```typescript
// 第 46 行 - 正则表达式中的中文标点
return /[。．.](?:[”"』」》）)]*)\s*$/.test(text.trim());

// 第 49 行 - 错误回退消息
function getErrorMessage(error: unknown, fallback = '生成失败'): string {

// 第 59 行 - 草稿项目名称
name: '草稿项目',

// 第 197 行 - 注释
// scratchpad 只在前端存储模式下使用，后端模式不需要创建/保存 scratchpad
```

#### 2. 翻译文件不完整

`zh-CN.ts` 和 `en-US.ts` 包含的翻译键**远少于**实际需要的量。

**缺失的翻译键** (部分列举):
- `settings.storageMode` - 存储模式
- `settings.backend` - 后端存储
- `settings.frontend` - 浏览器存储
- `project.createDefault` - 新项目
- `project.deleteConfirm` - 删除确认
- `project.deleteMessage` - 删除消息
- `voiceClone.record` - 录制
- `voiceClone.upload` - 上传
- `voiceClone.url` - URL
- `voiceClone.syncComplete` - 同步完成
- `voiceClone.syncFailed` - 同步失败
- `common.loading` - 加载中
- `common.error` - 错误
- `common.success` - 成功
- `common.confirm` - 确认
- `common.cancel` - 取消

#### 3. i18n 使用不一致

某些组件**已经导入并使用** `t()` 函数，但**同一文件中仍有硬编码中文**:

例如 `VoiceClone.tsx`:
- ✅ 导入了 `import { t } from '../i18n';`
- ✅ 在某些地方使用了 `t()`
- ❌ 但在 `inputMethodLabel()` 函数和错误消息中仍硬编码中文

---

## 🎨 UI 一致性问题详细分析

### 问题 1: 混用的样式方案

项目中存在**三种不同的样式方案**，导致视觉不一致和维护困难：

| 组件 | 样式方案 | 问题 |
|--------|----------|------|
| `Button` | Inline Styles | 应使用 CSS Modules 保持一致性 |
| `Modal` | Inline Styles | 难以维护和复用 |
| `Input` | Inline Styles | 难以应用全局主题变更 |
| `Alert` | Inline Styles | 同上 |
| `Slider` | Inline Styles | 同上 |
| `Tabs` | Inline Styles | 同上 |
| `ConfirmDialog` | CSS Modules ✅ | 正确做法 |
| `Card` | CSS Modules + Inline | 混合方案，应统一 |
| `AppShell` | CSS Modules ✅ | 正确做法 |

### 问题 2: 设计 Token 使用不完整

**`variables.css` 已定义完整的设计 Token**，但许多组件未使用：

**示例 - `Input.tsx`**:
```typescript
// ❌ 硬编码值
boxShadow: 'inset 0 1px 2px rgba(28, 25, 23, 0.06)'

// ✅ 应使用 Token
boxShadow: 'var(--shadow-inset)' // 需要新增此 Token
```

**示例 - `Modal.tsx`**:
```typescript
// ❌ 硬编码 rgba
backgroundColor: 'rgba(28, 25, 23, 0.4)'

// ✅ 应使用 Token
backgroundColor: 'var(--overlay-background)' // 需要新增此 Token
```

**示例 - `Button.tsx`**:
```typescript
// ❌ 硬编码 transition 时长
transition: 'all 200ms ease'

// ✅ 应使用 Token
transition: 'all var(--transition-normal)'
```

### 问题 3: 组件 API 不一致

**按钮组件**:
- `Button` 组件支持 `variant` 和 `size`，但样式是 inline 的
- 某些地方直接使用 `<button>` 而不是 `<Button>`
- 应统一使用 `<Button>` 组件

**卡片组件**:
- `Card` 组件支持 `interactive` 属性
- 但某些卡片样式是 ad-hoc 实现的，未使用 `Card` 组件

**对话框**:
- `Modal` 组件用于大型对话框
- `ConfirmDialog` 组件用于确认对话框
- 但某些确认操仍使用 `window.confirm()` (如 `App.tsx` 第 114 行)

---

## ♿ Accessibility 问题

### 问题 1: 缺失的 ARIA 标签

**`App.tsx`**:
```typescript
// ❌ window.confirm() 无法被屏幕阅读器正确识别
if (!window.confirm(`确定删除项目「${targetName}」？`)) return;

// ✅ 应使用 ConfirmDialog 组件
```

### 问题 2: 键盘导航

某些交互元素可能无法通过键盘访问，需要全面审计。

### 问题 3: 颜色对比度

需要验证所有文本颜色与背景的对比度是否符合 WCAG AA 标准 (4.5:1)。

---

## 🔧 UI 交互问题

### 问题 1: 加载状态不一致

- 某些组件使用 `loading` 属性
- 某些组件使用 `disabled` 状态
- 应统一加载状态的视觉表现

### 问题 2: 错误反馈不一致

- 某些错误使用 `Alert` 组件
- 某些错误使用 `console.error`
- 某些错误直接显示 `alert()`
- 需要统一的错误处理和展示机制

### 问题 3: 空状态设计

- 某些列表有空状态提示
- 某些列表没有
- 应统一空状态的设计和文案

---

## ✅ 改进方案 (优先级排序)

### 🔴 优先级 1: 关键 i18n 修复 (预计 2-3 天)

#### 步骤 1.1: 提取所有硬编码字符串

创建脚本自动扫描并提取所有硬编码中文字符串：

```bash
# 搜索所有 .tsx 和 .ts 文件中的中文字符串
grep -rn "['\"][\u4e00-\u9fa5]" src --include="*.tsx" --include="*.ts" | grep -v "node_modules" | grep -v "\.d\.ts"
```

#### 步骤 1.2: 扩展翻译文件

更新 `/src/i18n/zh-CN.ts` 和 `/src/i18n/en-US.ts`，添加所有缺失的翻译键：

```typescript
// zh-CN.ts 需要新增
export const zhCN = {
  // ... 现有内容 ...
  
  settings: {
    storageMode: '存储模式',
    backend: '后端存储',
    frontend: '浏览器存储',
  },
  
  project: {
    createDefault: '新项目',
    deleteConfirm: '确定删除项目「{name}」？',
    deleteMessage: '此操作不可撤销，所有章节和音频将一并删除。',
  },
  
  voiceClone: {
    record: '录制',
    upload: '上传',
    url: 'URL',
    syncComplete: '同步完成',
    syncFailed: '同步失败',
  },
  
  common: {
    loading: '加载中...',
    error: '错误',
    success: '成功',
    confirm: '确认',
    cancel: '取消',
    delete: '删除',
    edit: '编辑',
  },
};
```

#### 步骤 1.3: 替换所有硬编码字符串

将所有硬编码中文替换为 `t('key')` 调用：

**`App.tsx` 修复示例**:
```typescript
import { t } from '../i18n';

function SettingsSelect() {
  const { mode, setMode } = useStorageModeContext();
  return (
    <select value={mode} onChange={(e) => setMode(e.target.value as StorageMode)}>
      <option value="backend">{t('settings.backend')}</option>
      <option value="frontend">{t('settings.frontend')}</option>
    </select>
  );
}

// 修复删除确认
const handleDeleteProjectFromHub = async (projectId: string) => {
  const target = projects.find(project => project.id === projectId);
  const targetName = target?.name ?? t('common.unknownProject');
  
  // ❌ 移除 window.confirm
  // if (!window.confirm(`确定删除项目「${targetName}」？`)) return;
  
  // ✅ 使用 ConfirmDialog 组件
  setConfirmDialog({
    open: true,
    title: t('project.deleteConfirmTitle'),
    message: t('project.deleteMessage', { name: targetName }),
    onConfirm: async () => {
      await projectStorage.deleteProject(projectId);
      await refreshProjects();
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
    }
  });
};
```

---

### 🟡 优先级 2: UI 一致性改进 (预计 3-4 天)

#### 步骤 2.1: 统一组件样式方案

**决策**: 统一使用 **CSS Modules** 方案（与 `ConfirmDialog`、`AppShell` 一致）

**重构 `Button` 组件**:

创建 `/src/components/ui/Button.module.css`:

```css
/* Button.module.css */
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  font-family: inherit;
  font-weight: var(--font-weight-medium);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: all var(--transition-normal);
  outline: none;
  
  /* Size: md (default) */
  padding: 11px 22px;
  font-size: var(--font-size-base);
}

/* Variants */
.button--primary {
  background: var(--color-primary-gradient);
  color: var(--color-text-on-primary);
  box-shadow: 0 2px 8px var(--glow-primary);
}

.button--primary:hover:not(:disabled) {
  box-shadow: 0 4px 16px var(--glow-primary-strong);
  transform: scale(1.02);
}

.button--secondary {
  background: transparent;
  color: var(--color-primary);
  border-color: var(--color-primary);
}

/* ... 其他 variants ... */

/* Sizes */
.button--sm {
  padding: var(--spacing-xs) var(--spacing-md);
  font-size: var(--font-size-sm);
}

.button--lg {
  padding: 14px 28px;
  font-size: var(--font-size-lg);
}

/* States */
.button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  pointer-events: none;
}

.button--loading {
  position: relative;
  color: transparent;
}

.button__spinner {
  position: absolute;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: button-spin 0.6s linear infinite;
}

@keyframes button-spin {
  to { transform: rotate(360deg); }
}
```

更新 `Button.tsx`:

```typescript
import styles from './Button.module.css';

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  ...props
}) => {
  const classNames = [
    styles.button,
    styles[`button--${variant}`],
    styles[`button--${size}`],
    loading ? styles['button--loading'] : '',
    fullWidth ? styles['button--full-width'] : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      className={classNames}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && <span className={styles['button__spinner']} />}
      {children}
    </button>
  );
};
```

#### 步骤 2.2: 类似重构应用到所有 Inline Style 组件

需要重构的组件：
- `Modal.tsx` → `Modal.module.css`
- `Input.tsx` → `Input.module.css`
- `Alert.tsx` → `Alert.module.css`
- `Slider.tsx` → `Slider.module.css`
- `Tabs.tsx` → `Tabs.module.css`

#### 步骤 2.3: 扩展设计 Token

在 `variables.css` 中新增缺失的 Token：

```css
:root {
  /* ---- 新增 Overlay Token ---- */
  --overlay-background: rgba(28, 25, 23, 0.4);
  --overlay-blur: 8px;
  
  /* ---- 新增 Inset Shadow ---- */
  --shadow-inset: inset 0 1px 2px rgba(28, 25, 23, 0.06);
  
  /* ---- 新增 Focus Ring ---- */
  --focus-ring: 0 0 0 3px var(--glow-primary);
  
  /* ---- 统一定义 Transition ---- */
  --transition-fast: 150ms ease;
  --transition-normal: 200ms ease;  /* 统一为 200ms */
  --transition-slow: 300ms ease;
}
```

---

### 🟢 优先级 3: Accessibility 改进 (预计 1-2 天)

#### 步骤 3.1: 替换所有 `window.confirm()`

创建专门的 `ConfirmDialog` 组件（已存在，需推广使用）

#### 步骤 3.2: 添加缺失的 ARIA 标签

审计所有交互元素，确保：
- 所有按钮有 `aria-label` 或可读文本
- 所有表单输入有 `<label>` 或 `aria-label`
- 所有图标按钮有 `aria-hidden="true"`

#### 步骤 3.3: 验证颜色对比度

使用工具（如 axe DevTools）验证所有文本对比度 ≥ 4.5:1

---

### 🔵 优先级 4: 交互一致性改进 (预计 2 天)

#### 步骤 4.1: 统一加载状态

创建 `LoadingSpinner` 组件，统一加载状态视觉

#### 步骤 4.2: 统一错误展示

确保所有错误都通过 `Alert` 组件或 Toast 通知展示

#### 步骤 4.3: 统一空状态

创建 `EmptyState` 组件（已存在），确保所有列表都使用它

---

## 📊 预计改进时间线

| 阶段 | 任务 | 预计时间 | 优先级 |
|------|------|----------|--------|
| 1 | i18n 修复（提取字符串、扩展翻译文件、替换硬编码） | 2-3 天 | 🔴 P0 |
| 2 | UI 一致性（重构组件为 CSS Modules、扩展 Token） | 3-4 天 | 🟡 P1 |
| 3 | Accessibility 改进 | 1-2 天 | 🟢 P2 |
| 4 | 交互一致性改进 | 2 天 | 🔵 P3 |
| **总计** | | **8-11 天** | |

---

## 🛠️ 具体实施建议

### 建议 1: 分阶段实施

不要一次性重构所有组件，建议按以下顺序：

1. **先修复 i18n** - 这是功能缺失，影响国际化用户
2. **再统一 UI 组件** - 这是技术债务，影响长期维护
3. **最后优化交互** - 这是体验优化，可逐步迭代

### 建议 2: 创建组件重构 Checklist

为每个组件创建重构清单：

```markdown
- [ ] Button - 迁移到 CSS Modules
- [ ] Modal - 迁移到 CSS Modules  
- [ ] Input - 迁移到 CSS Modules
- [ ] Alert - 迁移到 CSS Modules
- [ ] Slider - 迁移到 CSS Modules
- [ ] Tabs - 迁移到 CSS Modules
```

### 建议 3: 使用自动化工具

创建脚本自动检测回归：

```bash
# 检测新的硬编码中文字符串
npm run i18n:check

# 检测 Inline Styles 使用
npm run style:check

# 检测 Accessibility 问题
npm run a11y:check
```

---

## 📝 结论

NarraForge 项目的 UI 一致性问题**源于快速迭代过程中缺乏统一的设计系统应用规范**。虽然设计 Token 已定义，但组件实现时未严格执行。

**最关键的改进是 i18n 支持**，因为这直接影响产品的国际化能力。

**其次是统一组件样式方案**，选择 CSS Modules 并严格执行，可以显著提升代码可维护性和视觉一致性。

建议按优先级分阶段实施，每个阶段完成后进行充分的测试和代码审查。

---

**文档版本**: 1.0  
**下一步**: 确认改进方案后，我可以协助生成具体的重构代码
