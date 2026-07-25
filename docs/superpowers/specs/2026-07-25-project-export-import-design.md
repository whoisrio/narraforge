# 项目导出 / 导入

**Status**: Approved
**Created**: 2026-07-25
**Branch**: feat/project-export-import
**Size**: Medium-Large

## 背景

用户有多个工作环境，切换时要把一个项目（文本 + 语音资产）从 env A 搬到 env B。
当前只有按章节导出音频/SRT，没有整项目导出/导入。

## 目标

导出一个项目为自包含 ZIP（文本 + 角色 + 音色 + 合成音频），导入到另一个环境后
新建一个等价项目，可立即继续工作。导出非破坏（不删原项目）。

## 前置：资产布局迁移

已运行 `backend/scripts/migrate_asset_layout`（`uv run python -m scripts.migrate_asset_layout`），
把所有 DB 项目的 text + segment 音频归到 `uploads/segmented/{pid}/` 规范命名，重写 DB 路径。
历史 legacy 散落布局的项目先迁移；迁移幂等可重跑。

## 范围（全量 (a)）

| 资产 | 来源 | 入包 |
|---|---|---|
| 项目/章节/段落文本 | DB 行 | manifest |
| 项目源/旁白文档 | 磁盘文件（`source_document_path`/`narration_document_path`） | text/ + manifest |
| segment 合成音频 | 磁盘（`segment.audio.current.path` 相对 `segmented_dir`） | assets/segments/ |
| 角色 | DB `roles`（project-scoped） | manifest |
| 音色配置 | DB `voice_profiles`（project-scoped） | manifest |
| 克隆试听/参考音频 | 磁盘（`voice_profile.preview.preview_audio_path` 等，相对 `base_dir`） | assets/voices/ |

## 非目标

- 不导出 Remotion 工程（`remotion_project_path` 导入时清空，重新 scaffold）。
- 不导出 cosyvoice 远端注册（voice_id 是远端 qwen 注册，不可移植；导入后该音色标记需重新克隆）。
- 不导出 `__scratchpad__` 草稿项目。
- 不做增量/差异导出。

## 包格式

```text
{project_name}.narraforge.zip
├── manifest.json          # bundle_version + DB 行快照 + 文件清单
├── text/
│   ├── source.md          # 项目源文档（若有）
│   ├── narration.md       # 项目旁白文档（若有）
│   └── chapters/{cid}/original.md, script.md   # 章节原文/改写稿（人读副本）
└── assets/
    ├── segments/{sid}.mp3
    └── voices/{voice_id}.{ext}
```

`manifest.json` 是真源：DB 行 + 每个文件的 bundle 内路径。segment 的 `audio.current.path`
在 manifest 里**重写**为 bundle 相对路径（`assets/segments/{old_sid}.mp3`）。

## 导出

`GET /api/segmented-projects/{id}/export` -> `application/zip` stream。

1. 查 project + chapters + segments + roles + voice_profiles + source_documents。
2. **守卫**：每个 segment 音频路径 + 文档路径必须位于 `uploads/segmented/{pid}/` 之下
   （迁移后所有 DB 项目满足）。否则 422 `project_assets_not_under_project_dir`。
3. 序列化 DB 行到 manifest（去掉绝对路径，segment audio path 重写为 bundle 路径）。
4. 收集文件入 `assets/` + `text/`。
5. 打包 ZIP 返回。**不删原项目，不动 DB。**

## 导入

`POST /api/segmented-projects/import`（multipart `file` = ZIP）-> 新 project detail。

1. 解压，读 manifest，校验 `bundle_version`。
2. **ID 全重映射**：生成新 project_id / chapter_id / segment_id / role_id / voice_profile_id，
   建 old->new 映射。
3. INSERT 行（project -> chapters -> segments -> roles -> voice_profiles -> source_documents），
   FK 用新 ID；`active_chapter_id` / `default_narrator_role_id` / `segment.role_id` 经映射重写。
4. 写音频文件：segment 音频写到新 `segment_audio_path`（用新 segment_id），voice 音频写到
   `voices_dir`/`clone_voices_dir`，**重写 DB 路径字段**指向新位置。
5. 走 `_mirror_to_filesystem` 重建 text 镜像；`source/narration_document_path` 重写到新位置。
6. `remotion_project_path` 清空。
7. 返回新 project detail。**不覆盖同名项目**（新建，name 保留）。

## 边界

- **cosyvoice 克隆**：`voice_type=clone, model=cosyvoice` 的 voice_profile，voice_id 是远端注册。
  导入后标记 `preview.needs_reclone = true`（合成时会失败提示重新克隆）。本地参考音频仍导入。
- **存储模式**：导入强制按 backend 模式落盘。若目标环境是 frontend 模式，导入项目音频仍走
  backend 路径（混合可接受）。
- **重名**：导入新建，name 保留原名（重名不阻塞）。
- **bundle_version** 不匹配 -> 422。

## 前端

- **导出**：`ProjectSettings` 加「导出项目」按钮 -> 触发浏览器下载 ZIP。
- **导入**：`ProjectHub`（项目工作台）加「导入项目」按钮 -> 选 ZIP 上传 -> 新项目卡片出现。

## 测试

- **Backend unit**：manifest 序列化往返；ID 重映射（FK 全更新）；路径重写。
- **Backend integration**：export -> import 往返，断言文本/角色/音色/音频全部还原（DB 行 + 文件存在）；
  导出不改原项目；导入新建不同 ID。
- **E2E**：导出项目 A（不删）-> 导入 -> 新项目 B 出现，断言 B 的章节文本/音色/音频可播放，且 A 仍在。

## 涉及文件

- `backend/app/services/project_export_service.py`（新）
- `backend/app/services/project_import_service.py`（新）
- `backend/app/api/segmented_projects.py`（加 export/import 端点）
- `frontend/src/services/api.ts`（加方法）
- `frontend/src/components/ProjectSettings/ProjectSettings.tsx`（导出按钮）
- `frontend/src/pages/ModelConfig.tsx` 或 ProjectHub（导入按钮）
- `docs/api-reference.md` / `backend/tests/TEST_MAP.md`（同步）
