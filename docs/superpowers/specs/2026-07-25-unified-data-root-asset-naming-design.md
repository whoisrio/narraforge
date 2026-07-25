# 后端统一存储根 + 项目资产语义命名（方案 B）

**Status**: Approved
**Created**: 2026-07-25
**Branch**: feat/semantic-asset-layout
**Related**: `docs/narration-git-versioning.md`、`docs/superpowers/specs/2026-07-25-narration-git-push-design.md`

## 背景

后端文件存储目前三足鼎立、命名混乱：

- `uploads/segmented/{project-uid}/chapters/chapter-{title}-{proj}-{id前6}/` — 项目资产。标题进路径导致**改名即产生新目录**，旧目录残留（langgraph-stream 一个项目有 10 个章节残目录）；`id前6` 取时间戳前缀，同批创建的实体后缀全部相同，反查失效（已引发 28 条音频路径漂移）。
- `uploads/voices/` + `output/clone_voices/` — 克隆样本/试听两处存放。
- `uploads/voices/tts_*.mp3` + `uploads/tts_results/` — TTS 历史音频两处存放。
- `uploads/srt/` + `output/srt/` — 字幕产物两处存放。
- `backend/data/` — narration-repo 文本版本库（此设计正确，保留）。

## 设计原则

1. **一个存储根**：所有应用数据统一在 `backend/data/` 下，`uploads/`、`output/` 废弃。
2. **DB 主键永不进路径构造的可变部分**；DB 存完整路径，路径只服务于文件定位。
3. **稳定性与可读性分离**：资产侧求稳（id），备份侧（narration-repo）求可读（语义），不互相兼任。
4. **改名零漂移**：高频改名（章节标题）路径不含标题；低频改名（项目名）走即时搬迁。
5. **运行时永远不读 narration-repo**；它是纯派生状态，可整体重建。

## 目标布局

```
backend/data/
├── narration-repo/                 # 文本版本库（git，不动）
│   └── projects/{project-slug}/chapters/{chNN}-{title-slug}/...
│
├── projects/                       # 项目资产（原 uploads/segmented/）
│   └── {project-slug}/
│       ├── manifest.json           # id → 名称/标题映射（已有，继续维护）
│       ├── source.md               # 源文档（内容落盘，DB 存路径）
│       ├── narration.md            # 完整旁白稿（同上）
│       ├── original.txt
│       └── chapters/{chapter-id}/
│           ├── original.txt
│           └── segments/
│               ├── {segment-id}.mp3
│               ├── {segment-id}.txt
│               └── {segment-id}.ssml
│
├── voices/
│   ├── profiles/{voice-slug}-{hash4}.mp3    # 克隆样本原音（PR-B）
│   └── previews/{engine}-{name}-{ts}.mp3    # 克隆/引擎试听（PR-B）
│
├── tts-history/tts_{audio_id}.mp3  # TTS 历史音频（PR-B）
├── srt/                            # 字幕识别产物（PR-B）
└── temp/                           # 临时文件，可安全清空（PR-B）
```

### 命名规则

| 层 | 规则 | 说明 |
|---|---|---|
| project-slug | `project_slug(name)`（pinyin/ASCII ≤40，同名加 `-{blake2s(id)前4}`） | 与 narration-repo 同一函数（`ids.py`） |
| chapter 目录 | 纯 DB `chapter.id` | 标题不进路径，改标题零成本 |
| segment 文件 | 纯 DB `segment.id` + 扩展名 | 同上 |
| 映射 | `manifest.json` 记录 id ↔ name/title | 人类查名看这里或 narration-repo |

与备份侧的对齐关系：项目级同名（`projects/{slug}`）；章节/段由 `manifest.json` 和 narration-repo 的 `chapter.yaml`（内含 DB id）双向可解析。资产侧不需要 `-{id6}` 后缀，因为目录名本身就是不可变 id。

## 改名语义

| 操作 | 频率 | 处理 |
|---|---|---|
| 章节改标题 / design_title | 高 | 零操作。目录是纯 id，无任何文件移动 |
| 段文本编辑/合并/拆分 | 高 | 零操作（id 由应用分配，路径随 id） |
| 项目改名 | 低 | **即时搬迁**：`save_project` 检测 name 变化 → 同一请求内完成 ①`mv {old-slug} {new-slug}` ②同事务重写 DB 路径（`segment.audio` 前缀、`source_document_path`、`narration_document_path`）③更新 manifest。失败兜底：目录没搬成不致命（DB 旧路径仍可播放），记日志，后续快照/迁移可再收敛 |
| 项目删除 | — | `remove_project_dir` 按 slug 删目录（先看 DB 记录的路径兜底） |

## 影响面与改动清单

### A. 路径构造（`app/core/config.py` + `app/core/segmented_assets.py`）

- `config.py`：新增 `data_dir = base_dir / "data"`；`projects_dir = data_dir / "projects"`（替代 `segmented_dir`）；voices/srt/temp 常量在 PR-B 处理。保留 `SEGMENTED_DIR` 环境变量覆盖以兼容。
- `segmented_assets.py`：
  - `project_dir(project)` 改为按 slug（签名从 `project_id` 改为接收项目对象或 `(id, name)`）。
  - `_chapter_dirname` 废弃，`chapter_dir = projects/{slug}/chapters/{chapter.id}`。
  - `segment_basename` 废弃，文件名即 `{segment.id}.{fmt}`。
  - 项目级文档文件名简化为固定 `source.md` / `narration.md`（原 `source-{name}-{id6}.md` 形式废弃；DB 存绝对路径，读取不受影响）。
- 兼容性：DB 中已有旧路径（`uploads/segmented/...` 相对路径、绝对路径）在迁移前必须保持可读——读取端一律以 DB 存储路径为准，不做路径推算。

### B. 写入方（新文件按新布局落盘）

1. `segmented_project_service.py` 段落合成主路径（mp3/wav 两分支）。
2. `app/api/segmented_projects.py` 单段合成端点。
3. `app/api/tts.py`、`app/api/mimo_tts.py` 合成落盘。
4. `project_import_service.py` 导入还原音频（导入时按新布局写）。
5. `_mirror_to_filesystem`（每次 PUT 的文本镜像）：写新布局 + 清扫本章不再需要的旧章节目录（仅当目录名不是当前任何 chapter.id 且属于本项目时删除——防止误删历史音频所在目录？**决策：镜像清扫只删纯文本镜像，含音频的目录由删除逻辑处理**）。

### C. 删除/清理方（统一改为"DB 路径优先"）

1. `remove_segment_audio`：当前按 id 重建路径再删（命名一变即失效，是既有 bug）。改为：优先取 DB `audio.current/previous.path` 指向的文件删除，重建路径仅作兜底。
2. `remove_chapter_dir` / `remove_project_dir`：同样 DB 路径优先 + 现名重建兜底。
3. `save_project` 孤儿段清理、`_delete_dropped_audio_files`（已是 DB 路径驱动，无需改）。

### D. 项目改名即时搬迁

- 在 `save_project` 中对比 `existing.name` 与 `project.name`：不同则触发 `_relocate_project_assets(db, old, new)`。
- 步骤：计算新旧 slug → 若旧目录存在则 `shutil.move` → 重写该项目所有 `segment.audio.current/previous.path`（前缀替换）+ `source_document_path`/`narration_document_path`（绝对路径前缀替换）→ 更新 manifest。
- 同事务提交；搬目录失败则跳过路径重写并记 warning（不产生半状态：目录没动，DB 也不动）。

### E. 存量全量迁移（一次性脚本 `scripts/migrate_to_data_root.py`）

复用 `app/services/migrate_asset_layout.py` 的计划/执行两段式（`flag_modified` 写 JSON 列）：

1. **dry-run 默认**：输出每个项目的 dir/file 移动计划和 DB 重写计数，不写盘。
2. **apply**：
   - `uploads/segmented/{uid}/` → `data/projects/{slug}/`（整目录移动；`{slug}` 由项目名计算，冲突加 hash 后缀）。
   - 章节目录 `chapter-*` → `{chapter.id}`（按目录名尾缀 id 匹配；匹配不到的目录保留并报告）。
   - 段文件统一为 `{segment.id}.{ext}`（按 DB audio 路径指向的文件逐一移动）。
   - 重写 DB：`segment.audio.*.path`（相对路径改为 `projects/{slug}/...` 新前缀）、`source_document_path`/`narration_document_path`。
   - 移动 `uploads/srt`、`uploads/voices` 等（PR-B 范围，本脚本只做 projects 树）。
   - 幂等：已在新位置的跳过。
3. **前置条件**：停后端、备份 DB + tar 备份 uploads。
4. 跳过不属于当前 DB 的目录（e2e 种子、孤儿项目目录），报告中列出。

### F. 读取方（无需改动，验证即可）

- `GET /audio/{cid}/{sid}`：按 DB 路径解析，天然兼容。
- 章节合并导出 `export_chapter_audio_mp3`：输出目录走 `chapter_dir`（新布局）；输入按 DB 路径。
- Remotion scaffold / SRT 导出：按 DB 路径。

### G. 前端 / e2e

- 前端运行时代码零改动（全部走 API）。
- e2e `tests/e2e/helpers/fsAssertions.ts`：路径拼接规则更新（`data/projects/{slug}/chapters/{cid}/segments/{sid}.{ext}`）；涉及 spec：studio-segment-operations、studio-batch-export、project-crud、settings-animation-root。

### H. 测试

- `test_segmented_assets.py`：新路径构造（slug、纯 id 章节/段、同名项目 hash 后缀）。
- 改名搬迁：name 变化 → 目录移动 + DB 路径重写 + 失败兜底；name 不变 → 零操作。
- 删除逻辑：DB 路径优先（旧命名/新命名两种路径都能删）。
- 迁移脚本：dry-run 不写盘；apply 后文件在位、DB 路径一致、幂等重跑无变化；多章节项目（本次事故的重灾区，必须覆盖）。
- e2e 全套回归。

### I. 文档

- `docs/database-schema.md`：`audio.path` 前缀说明（`projects/{slug}/...`）。
- `docs/narration-git-versioning.md`：两树对齐关系（项目级同名、manifest 映射）。
- `docs/ENV.md`：`SEGMENTED_DIR` → 新变量/默认值说明。
- `AGENTS.md` 存储路径约定。

## PR 划分

- **PR-A（本设计）**：统一 `data/` 根 + 项目资产命名 + 改名即时搬迁 + 删除 DB 路径优先 + 存量迁移脚本 + 在 dev 库执行迁移。
- **PR-B（后续）**：`voices/`（profiles/previews）、`tts-history/`、`srt/` 归位，`output/` 废弃，`voice_profiles.source_audio_path` 真正入库，对应迁移。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 迁移中应用读写文件导致半状态 | 迁移前置：停后端；脚本先 dry-run 审阅 |
| 改名搬迁与并发 PUT 冲突 | 搬迁在同一请求事务内；失败只记日志不产生半状态 |
| 旧 DB 备份/其他环境仍是旧布局 | 路径构造函数不用于读取，读取永远走 DB 存储路径 |
| e2e 与 dev 共用 data 根 | 迁移脚本跳过非本库目录；e2e 种子项目走同一命名规则，互不干扰 |

## 明确不做

- 音频不进 narration-repo（维持文本版本库定位）。
- 章节/段级改名搬迁（用纯 id 已免疫）。
- 前端任何改动。
