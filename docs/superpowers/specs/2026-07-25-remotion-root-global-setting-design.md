# Remotion 脚手架根位置全局设置

**Status**: Approved
**Created**: 2026-07-25
**Size**: Small

## 背景

`knowledge_video` workflow 的 `scaffold_remotion` 节点会在本地生成一个 Remotion 工程。
目标目录的根位置 `ANIMATION_ROOT_FOLDER` 目前硬编码在 `agent/.env`，由 agent 进程读取，
没设就直接报错中断 workflow。用户无法在运行时通过 UI 修改它，多工作环境切换也不方便。

## 目标

把根位置提升为 backend 管理的**全局设置**（存 DB），可在 `/settings` 页面配置；
agent 不再读 env，解析逻辑下沉到 backend，单一数据源。

## 非目标

- 不改 per-project `remotion_project_path` 的现有语义（项目级仍优先于全局）。
- 不做目录浏览器（浏览器无法选服务端目录），只用文本输入 + 路径探测。
- 不做历史路径迁移：已有 `remotion_project_path` 的项目保持不变。

## 设计

### 数据模型 / 存储

- 新增 `SystemConfig` 键 `animation_root_folder`（字符串，绝对路径）。
  复用现有 `system_config_service.get_config / set_config`，无需 DB migration（键值表，新 key 直接写入）。
- `system_config_service` 新增两个 helper（仿 `get/set_storage_mode`）：
  - `get_animation_root_folder(db) -> str | None`（空字符串视为未设置，返回 None）
  - `set_animation_root_folder(db, value: str)`（`strip()` + `expanduser()` 后存）
- **废弃** `agent/.env` 的 `ANIMATION_ROOT_FOLDER`：
  - 从 `agent/.env.example` 删除该行。
  - 从 `agent/app/config.py` 删除 `get_animation_root_folder()`。
  - 已部署的 env 变量直接被忽略（不报错），向后兼容。

### 解析层级（backend 解析）

`remotion_scaffold_service.scaffold_remotion_project` 内解析目标目录：

```text
target = body.target_dir                                       # 每次运行覆盖（UI 指定）
      or project.remotion_project_path                          # 项目级
      or {get_animation_root_folder(db)}/{safe_project_dirname(project.name)}  # 全局默认
```

- 三者全空 -> `raise ValueError("animation_root_not_configured")` -> 端点返回 **422**。
- `safe_project_dirname` 从 agent 移植到 backend（放进 `remotion_scaffold_service`），
  规则与现版完全一致，保证已生成的项目路径不变：
  - 剥离 `[<>:"/\\|?*\x00-\x1f]` 非法字符为 `_`
  - 折叠空白为 `_`，strip 首尾 `_. ` 空白
  - 空结果回退 `"project"`，保留 CJK

### 后端 API（config 路由）

照搬 `/storage-mode` 模式，在 `backend/app/api/config.py` 新增：

```text
GET  /api/config/animation-root        -> { "value": str | null }
PUT  /api/config/animation-root        body { "value": str }
       -> 校验：非空、可 mkdir -p、可写（写临时文件探测）；失败 422 + 原因
       -> 成功 set_animation_root_folder，返回 { "value": str }
POST /api/config/animation-root/test   body { "value": str }
       -> 同样的探测但不保存，返回 { "ok": bool, "error": str | null }
```

路径语义：这是 **backend 服务器本机**的文件系统路径（backend 跑在 127.0.0.1，与用户同机）。
在 `docs/ENV.md` 与 `docs/RUNBOOK.md` 注明。

### Agent 改动

`agent/app/nodes/knowledge_video/scaffold_remotion.py`：

- 删除 `from app.config import get_animation_root_folder`。
- 删除 env 读取 + `get_project` + `safe_project_dirname` 计算那段逻辑。
- 简化为：`target_dir = state.get("target_dir")`（仅每次运行覆盖），
  `await backend.scaffold_remotion(project_id, target_dir=target_dir)`（None 时不传字段，backend 自己解析）。
- backend 返回 422 `animation_root_not_configured` 时，emit 带引导文案的 error：
  "未配置 Remotion 脚手架根目录，请到设置页填写"。

`agent/app/config.py` 删 `get_animation_root_folder()`；`agent/.env.example` 删该行。

### 前端改动

在现有 `/settings` 页（`ModelConfig.tsx`）新增 section "Remotion 脚手架根目录"：

- 文本输入框（placeholder：`/Users/you/animation-projects`）+「保存」+「测试路径」按钮。
- mount 时 `GET /api/config/animation-root` 回填。
- 保存走 `PUT`，失败 toast 显示原因（不可创建/不可写）。
- 测试走 `POST .../test`，实时反馈 ok / 错误。
- 新增 i18n key（zh-CN + en），命名 `settings.animationRoot.*`。
- 不动 header 里的 storage_mode 开关。

### 错误处理 / 边界

- 设置未配 + 无项目级路径 + 无运行覆盖 -> 422 + drawer 引导去设置页。
- 已有 `remotion_project_path` 的项目 -> 不动，项目级仍优先。
- 路径含 `~` / 尾部斜杠 -> backend `expanduser()` + `normpath()` 归一。
- 路径不可写 -> 保存/测试拒绝，明确报错。
- 多工作环境：根位置是 DB 键，不同环境各自设各自的值（与 #3 项目导入导出互补）。

## 测试

- **Backend unit**：`get/set_animation_root_folder` 往返；解析层级（覆盖 > 项目级 > 全局 > 全空报错）；
  `safe_project_dirname` 移植后与旧版输出一致（表驱动用例）；scaffold 端点未配时 422、已配时 200。
- **Backend integration**：设全局根 -> scaffold 生成在 `{root}/{name}`；项目级路径存在时优先；运行覆盖最高。
- **Agent unit**：scaffold 节点仅当 state 有 `target_dir` 才传；422 时 emit 引导 error。
- **Frontend**：设置 section 加载/保存/测试反馈；i18n。
- **E2E**：UI 设根 -> 跑 kv workflow -> 断言 Remotion 工程落在配置的根下。

## 涉及文件

- `backend/app/core/system_config_service.py` - 新增 get/set helper
- `backend/app/api/config.py` - 新增 3 个端点
- `backend/app/services/remotion_scaffold_service.py` - 解析层级 + 移植 `safe_project_dirname`
- `agent/app/nodes/knowledge_video/scaffold_remotion.py` - 简化节点
- `agent/app/config.py` - 删 `get_animation_root_folder`
- `agent/.env.example` - 删 `ANIMATION_ROOT_FOLDER`
- `frontend/src/pages/ModelConfig.tsx` - 新增 section
- `frontend/src/services/api.ts` - 新增 configApi 方法
- `frontend/src/i18n/` - 新增 key
- `docs/ENV.md` / `docs/RUNBOOK.md` - 文档更新
