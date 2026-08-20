# Try 页（粘贴文档 → 一键 TTS 获客页）设计

日期：2026-08-20
状态：已确认需求，待实现

## 背景与目标

线上 workers 部署形态需要一个低门槛入口：用户粘贴整份文档即可合成语音，无需注册、无需理解项目/分段概念。
该页面同时承担 SEO 获客职责，通过搜索引擎与社交分享带来新用户，并引导其注册使用完整版。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 入口形态 | Vite 多页入口（独立 HTML entry + 独立小 bundle），URL `/try` |
| 引擎 | 仅 edge_tts（免费额度，匿名开放无成本风险）；MiMo 作为注册后卖点 |
| 后端角色 | 仅作无状态合成代理；不做项目持久化、不需要登录 |
| 文本组织 | 无分段概念，整份文档一次合成一个音频 |
| 字数上限 | 单次合成 3000 字 |
| 限流 | 单 IP 每日 50 次合成 |
| 历史记录 | 页面自带 TTS 记录，支持重复下载、单条删除、一键清空 |
| 下载策略 | 不限制下载；每会话首次下载弹一次非阻断的完整版推荐弹窗 |
| 转化入口 | 页面提供「试用完整功能」CTA，带文档内容跳转主 SPA |
| 语言 | 首期只做英文页；中文 entry 后置 |
| 人机验证 | 首期不做 Turnstile，仅 IP 限流；出现滥用再加 |

## 架构

### 前端入口

- 新增 `frontend/try.html` 与 `frontend/src/try/main.tsx`，构建为独立小 bundle。
- 共享 i18n、设计 tokens、`apiUrl`、`EdgeTTSParameterControls`、`VoiceSelector`、`AudioPlayer` 等轻组件。
- 不引入主 SPA 的项目管理、路由、auth 上下文等重依赖。

### SEO

- 营销内容（H1、产品介绍、使用步骤、FAQ）静态写入 HTML，不依赖 JS 执行即可被爬虫读取。
- 完整 meta/OG/Twitter 卡片标签，含分享图。
- JSON-LD 结构化数据：`SoftwareApplication` + `FAQPage`。
- 新增 `sitemap.xml` 与 `robots.txt`（若已存在则补充 `/try`）。
- 中文 entry 后置，届时用 hreflang 互指。

### 数据流

1. 用户粘贴文本（≤3000 字），选择 edge_tts 声音与语速/音量/语调参数。
2. 前端调用 `POST /api/tts/synthesize`（engine=edge_tts，已在匿名白名单）。
3. 返回音频 blob，页面内播放器试听，可下载 MP3。
4. 每条合成记录写入 IndexedDB `tts_results` store。
5. 点击「试用完整功能」：当前文档文本存入 sessionStorage（`try_handoff_text`）→ 跳转主 SPA → TTSSynthesis 挂载时 peek，目标章节为空才应用并 consume（非空保留 stash，后续空项目仍可接入）。
   未登录用户先走登录页；stash 存 sessionStorage，同标签页登录跳转后仍在。
   （设计评审后修正：不写 scratchpad IDB 草稿——workers 模式的 MigrationPrompt 明确排除 scratchpad，该路径无法迁移。）

## 功能细节

### 合成区

- 单个大输入框，实时字数统计，超过 3000 字禁止合成并提示。
- 声音列表来自匿名端点 `GET /api/tts/edge-voices`。
- 参数控件复用 `EdgeTTSParameterControls`。
- 合成结果：一个完整音频，播放器试听 + 下载按钮。

### 长文本兜底

后端 `edge_tts_ws_client` 目前是单条 SSML 全文发送，无内部分片。
实现时先验证微软端对单条 SSML 的实际长度限制：若 3000 字内有风险，则在后端透明分片合成并拼接，用户无感知。
能不引入分片就不引入。

### 历史记录

- 复用 IndexedDB `tts_results` store 与现有 `saveTTSResult` / `getTTSHistory` / `deleteTTSResult` / `getTTSAudioBlob` API。
- 记录结构复用 `TTSLocalRecord`（id/text/voice_id/voice_name/audioBlob/audio_format/speed/volume/pitch/instruction/language/created_at/source），`source` 新增取值 `'try_page'`，无需变更 schema。
- 复用同一 store 的好处：用户进入完整版后历史天然延续。
- 历史列表支持：重新播放、重复下载、单条删除、一键清空（带确认）。
- 需补充一个 `clearTTSHistory()` API（现有 store 只有单条删除）。

### 转化组件

- **下载推荐弹窗**：每会话（sessionStorage 标记）首次点击下载时弹一次，非阻断。
  文案要点：注册完整版可保存项目、云端同步、解锁 MiMo 高表现语音。
  按钮：「继续下载」（主）、「了解完整版」（次，跳主 SPA）。
- **「试用完整功能」CTA**：常驻页面顶部。
  点击时把当前输入框文本 stash 到 sessionStorage 再跳转；主应用侧 peek/apply-if-empty（见「数据流」），保证用户进度不丢且绝不覆盖已有项目内容。

## 后端改动

- 功能端点零改动：`POST /api/tts/synthesize`（edge_tts）与 `GET /api/tts/edge-voices` 已在匿名白名单。
- 新增 IP 级限流：单 IP 每日 50 次 edge_tts 匿名合成。
  实现位置：`app/core/` 新增轻量限流中间件或对 synthesize 端点加依赖注入；workers 形态用 Supabase 表计数（参考现有 `daily_stats` 模式），local 形态用内存计数。
- 超限返回 429 与明确的错误信息，前端展示「今日试用次数已用完，注册完整版解除限制」。
- 埋点：合成请求走现有 stats middleware（best-effort 匿名统计），不新增设施。

## 部署

- workers 形态：`try.html` 随前端静态资源一起部署，无需额外服务。
- 需要确认部署平台（Vercel/Cloudflare Pages）的 rewrite 规则不影响 `/try` 直达。

## 测试

### 前端单测

- 字数统计与 3000 字上限校验。
- 历史记录：写入、列表渲染、单条删除、一键清空、重复下载。
- 下载推荐弹窗：每会话只弹一次。
- CTA：草稿写入 drafts store。

### E2E（tests/e2e/）

- 完整链路：打开 `/try` → 粘贴文本 → 选声音 → 合成 → 试听 → 下载（首弹窗出现且仅一次）→ 历史记录出现该条 → 重复下载 → 单条删除 → 一键清空。
- 转化链路：CTA 跳转主 SPA，文档内容带入 scratchpad。
- 限流链路：mock 或注入方式触发 429，展示注册引导文案。

## 风险与开放项

- 微软单条 SSML 长度限制待实测，必要时引入后端透明分片。
- `TTSLocalRecord.source` 的取值集合需要在前端类型注释中补充 `'try_page'`。
- 限流在 workers（Supabase 计数）与 local（内存计数）两种形态下的实现差异，实现时确定细节。
- 中文 entry、Turnstile、分享卡片 OG 图片为后置项。
- backend 存储模式下 synthesize 只回 `audio_url`，前端需回取音频转 Blob（已实现，注意剥掉 `/api` 前缀再拼 `API_BASE_URL`）。
