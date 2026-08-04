# 一键导出所有章节的音频与 SRT — 设计文档

日期：2026-08-04
分支：`feat/export-all-chapters`
状态：已获用户批准（方案 A）

## 目标

在工作室提供「导出全部」一键操作：把项目**所有章节**的合成音频（mp3）与字幕（srt）写入项目指定的导出目录。
每章产出一对同名文件：`{安全章节标题}.mp3` + `{安全章节标题}.srt`。

## 已确认的需求决策

- **导出位置**：复用项目级 `configs.export_directory`，并把它与 `remotion_project_path` 解耦（见「目录解析」）。
- **存储模式**：仅 backend 存储模式可用。
  frontend（IndexedDB）模式下服务端拿不到音频，入口隐藏。
- **SRT 时间轴**：章节内从 0 开始（与该章 mp3 自洽），复用 `srt_service.build_srt`（自动清洗风格 tag）。
- **不完整章节**：任一章节存在缺音频的段落 → 整体中止，不写出任何文件，返回不完整章节清单。

## 目录解析规则

`resolve_export_target_dir(project)`：

1. `export_directory` 为绝对路径（或 `~` 开头）→ 直接使用（expanduser），无论 remotion 是否配置。
2. 否则（相对路径或未设置）且 `remotion_project_path` 已配置 → `{remotion_project_path}/{export_directory || 'public/audio'}`（保持现状）。
3. 否则 → `ValueError("export_directory_not_configured")` → 409，前端提示去项目设置配置。

目标目录不存在时自动 `mkdir -p`。

## 后端

### 新端点

`POST /api/segmented-projects/{pid}/export-all-chapters`

- 200：`{exported: [{chapter_id, title, audio_path, srt_path}], count: N}`（路径为服务端绝对路径）。
- 404：`project_not_found`。
- 409：`export_directory_not_configured`（未配置可用导出目录）。
- 409：有不完整章节 —— detail 为 `{code: "chapters_incomplete", message: "...", chapters: ["章节名", ...]}`（dict detail 对当前 FastAPI 与 A8 handler 均兼容）。
- 422/500：ffmpeg 不可用或拼接失败。

### Service

`export_all_chapters(db, project_id)`（`app/services/segmented_project_service.py`，紧邻 `export_chapter_audio_mp3`）：

1. 取项目，解析目标目录（上述规则）。
2. 预检：按 position 遍历所有章节的所有段落，缺 `audio.current.path` 或文件不存在 → 收集章节名；非空则中止（不写任何文件）。
3. 逐章：复用 `export_chapter_audio_mp3` 的拼接逻辑生成 `{安全标题}.mp3` 到目标目录；`build_srt(segments)` 生成 `{安全标题}.srt`（章节内从 0 开始）。
4. 返回导出清单。

`export_chapter_audio_mp3` 当前把路径解析与 remotion 耦合在 `_chapter_audio_export_path`；为实现复用，抽出「给定目标目录 + 章节 → 拼接写盘」的内部 helper，原端点行为不变。
章节标题安全化复用现有的 safe_chapter_title 逻辑，保证 mp3 与 srt 同名。

## 前端

- **入口**：工作室工具栏「导出」按钮旁新增「导出全部」按钮，仅 `storageMode === 'backend'` 时渲染。
- **成功**：toast 显示导出目录与文件数（如「已导出 3 章到 /path/to/dir」）。
- **409 chapters_incomplete**：弹窗列出不完整章节名，提示先完成合成。
- **409 export_directory_not_configured**：toast 提示去项目设置配置导出目录。
- **项目设置**：exportDir 输入框提示文案更新——说明未配置 Remotion 路径时可直接填绝对路径作为独立导出目录。
- i18n：zh-CN / en-US 同步。

## 测试（TDD）

- 后端 `backend/tests/test_export_all_chapters.py`：
  - 目录解析三种形态（绝对路径优先 / remotion 相对 / 未配置报错）。
  - 预检：缺音频段落 → 409 + 章节清单，且目标目录无文件写出。
  - 成功路径：两章各产出 mp3+srt，SRT 从 0 开始、时长累计正确、风格 tag 被清洗。
- 前端：`TTSSynthesis` 或独立组件测试——按钮仅 backend 模式可见；409 弹窗展示章节清单。
- E2E `tests/e2e/specs/export-all-chapters.spec.ts`：建两章项目 → 用录入上传端点给段落配音频（fixture mp3，无需真实 TTS）→ 点「导出全部」→ 磁盘双读验证 mp3+srt 存在且 SRT 内容合法；再验证不完整项目的 409 提示。

## 文档

- `docs/api-reference.md`：新端点 + export_directory 解析规则。
- `docs/feature-spec.md`：Studio 批量操作表新增「导出全部」。
- `backend/tests/TEST_MAP.md`：新测试行。
- `docs/e2e-test-guide.md`：用例计数 46 → 47。

## 非目标（YAGNI）

- 不做跨章全局时间轴 SRT。
- 不做双语 SRT、JSON 导出。
- 不做 frontend 存储模式的 zip 下载。
- 不改动 scaffold-remotion 的现有导出行为。
