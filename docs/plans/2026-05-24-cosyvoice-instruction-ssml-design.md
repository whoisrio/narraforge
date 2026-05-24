# 2026-05-24-cosyvoice-instruction-ssml-design.md

## 概述

将 CosyVoice 合成参数从无效的「语气(emotion)」改为「复刻指令(instruction)」，并新增 SSML 开关和 Markdown 过滤开关。

## 变更范围

### 后端 API (`backend/app/api/tts.py`)

**TTSRequest 模型变更：**

| 字段 | 操作 | 说明 |
|---|---|---|
| `emotion: str` | 删除 | 对 CosyVoice 模型无实际作用 |
| `instruction: str` | 修改默认值 | 从 `"字正腔圆，播音腔"` 改为 `"音调偏高，语速中等，充满活力和感染力，适合广告配音"` |
| `enable_ssml: bool = False` | 新增 | 传入 CosyVoice ops 的 enable_ssml 参数 |
| `enable_markdown_filter: bool = False` | 新增 | 传入 CosyVoice ops 的 enable_markdown_filter 参数 |

**BatchTTSRequest 模型变更：**

| 字段 | 操作 |
|---|---|
| `emotion: str` | 删除 |

**`/synthesize` 路由**：将新参数透传到 service 层。

---

### 后端 Service (`backend/app/services/qwen_tts_service.py`)

**`synthesize_speech` 方法：**
- 签名移除 `emotion` 参数
- 新增 `enable_ssml: bool = False`、`enable_markdown_filter: bool = False`
- 透传到 `_synthesize_voice_cosyvoice`

**`_synthesize_voice_cosyvoice` 方法：**
- ops 字典中 `enable_ssml` 和 `enable_markdown_filter` 改为接收参数，不再硬编码

---

### 前端类型 (`frontend/src/types/index.ts`)

**TTSRequest：**
- 删除 `emotion`
- 新增 `instruction?: string`
- 新增 `enable_ssml?: boolean`
- 新增 `enable_markdown_filter?: boolean`

**TTSResult.params：**
- 删除 `emotion`
- 新增 `instruction?: string`
- 新增 `enable_ssml?: boolean`
- 新增 `enable_markdown_filter?: boolean`

**TTSResultRecord：**
- 删除 `emotion`
- 新增 `instruction?: string`

---

### 前端参数控件 (`frontend/src/components/TTSSynthesis/ParameterControls.tsx`)

**删除：**「语气」下拉框

**新增：**

1. 「复刻指令」文本输入框（maxLength=50）
2. 预设快速选择按钮（3个）：
   - `广告配音` → `"音调偏高，语速中等，充满活力和感染力，适合广告配音"`
   - `播音主持` → `"吐字清晰精准，字正腔圆"`
   - `温柔治愈` → `"语速偏慢，音调温柔甜美，语气治愈温暖，像贴心朋友般关怀"`
3. SSML 开关（默认关闭）
4. 过滤 Markdown 标记开关（默认关闭）

**持久化：** `instruction`、`enable_ssml`、`enable_markdown_filter` 存入 localStorage。

---

### 主页面 (`frontend/src/pages/TTSSynthesis.tsx`)

- params 和请求中删除 `emotion`，加入 `instruction`、`enable_ssml`、`enable_markdown_filter`
- 历史记录展示同步更新

### 旧版控件 (`frontend/src/components/TTS/TTSControls.tsx`)

- 删除 `emotion` 相关的 state 和 UI
- 加入 `instruction` 输入框

---

## 预设复刻指令常量

```typescript
const INSTRUCTION_PRESETS = [
  { label: '广告配音', value: '音调偏高，语速中等，充满活力和感染力，适合广告配音' },
  { label: '播音主持', value: '吐字清晰精准，字正腔圆' },
  { label: '温柔治愈', value: '语速偏慢，音调温柔甜美，语气治愈温暖，像贴心朋友般关怀' },
] as const;
```

## 注意事项

- SSML 和过滤开关仅在 CosyVoice 引擎生效，Edge-TTS 不展示
- 旧版 TTSControls.tsx 组件中存在但保持简化处理（不增加两个开关）