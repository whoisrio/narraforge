# Studio 修复概览 — 2026-07-02

## 修改的三类问题

### 1. 分段时间显示不正确

**根因**：`SegmentList.tsx` 使用已弃用的 `seg.duration_sec`（始终为 0），而生成后实际更新的值是 `seg.audio.duration_sec`。

**修复**：改用 `seg.audio.duration_sec`，同时 `fmtTime` 增加了小时位支持。

| 文件 | 修改内容 |
|------|----------|
| `Component/SegmentedTTS/SegmentList.tsx` | `seg.duration_sec` → `seg.audio.duration_sec` |
| `Component/SegmentedTTS/SegmentRow.tsx` | `fmtTime` 增加 `H:MM:SS.s` 格式 |
| `Component/VoiceStudio/VoiceStudioLayout.tsx` | `formatDuration` 增加 `H:MM:SS` 格式 |

### 2. ProjectSettings 字段太多

移除了 `project_type`、`default_language`、`export_naming_template` 和 Defaults 卡片，只保留：项目名称、描述、Remotion 路径、默认导出目录。

| 文件 | 修改内容 |
|------|----------|
| `Component/ProjectSettings/ProjectSettings.tsx` | 简化 UI 和 Props |
| `Component/ProjectSettings/ProjectSettings.test.tsx` | 更新测试 |
| `Component/ProjectSettings/ProjectSettings.module.css` | 清理废弃样式 |
| `pages/TTSSynthesis.tsx` | 移除多余的 props |
| `hooks/useSegmentedProject.ts` | `SET_PROJECT_META` 类型简化 |

### 3. 导出目录不生效且不自动创建

`export_directory` 原本只在设置页编辑，但导出流程完全不使用它。现在：

- **前端**：`ExportDialog` 接收 `exportDirectory`，传递给后端 API
- **后端**：接收 `export_directory` 参数，相对于 `remotion_project_path` 解析路径，`mkdir -p` 自动创建
- 顺便修复了 `ExportDialog` 缺失的 `getTTSAudioBlob` import

| 文件 | 修改内容 |
|------|----------|
| `Component/SegmentedTTS/ExportDialog.tsx` | 新增 `exportDirectory` prop + 修复 import |
| `services/api.ts` | API 函数增加 `exportDirectory` 参数 |
| `api/segmented_projects.py` | 端点接收 `export_directory` 参数 |
| `schemas/segmented_project.py` | `ExportTextFileRequest` 增加字段 |
| `services/segmented_project_service.py` | 用 `export_directory` 解析路径 + `mkdir` 自动创建 |
