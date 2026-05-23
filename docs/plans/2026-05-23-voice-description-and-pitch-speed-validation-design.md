# 声音描述功能 & Pitch/Speed 参数校验优化

## 日期
2026-05-23

## 概述

两个独立但同批实施的改动：
1. **声音描述功能**：为从 Qwen 同步的克隆声音增加用户自定义描述，有描述时界面显示描述，没有时显示 voice_id
2. **Pitch/Speed 参数校验**：统一 pitch 为 float 比率制（和 speed 一致），前后端加取值范围校验

---

## 1. 声音描述功能

### 动机

从 Qwen 服务获取的克隆声音列表只有 `voice_id`，没有有意义的标识名称，用户难以区分不同声音。

### 方案

选择**方案 A：专用 PATCH 接口 + 内联编辑**。

#### 1.1 数据库变更

`VoiceProfile` 模型新增 `description` 列：

```python
description = Column(String, nullable=True)  # 用户自定义的声音描述
```

已有数据行 `description` 默认为 NULL，SQLAlchemy 自动处理 DDL。

#### 1.2 API 变更

**新增：`PATCH /api/clone/{voice_id}/description`**

```
Request:  { "description": "小明的声音 - 普通话男声" }
Response: { "id": "xxx", "description": "小明的声音 - 普通话男声" }
Error:    404（voice_id 不存在）、500（数据库错误）
```

特殊处理：空字符串 `""` 视为清除描述，后端将其转为 `NULL` 存储。

**修改：`GET /api/clone/list`**

返回体中增加 `description` 字段。

#### 1.3 前端变更

**交互流程：**

```
[显示态]  小明的声音 - 普通话男声  ✏️
              ↓ 点击 ✏️ 图标
[编辑态]  [________________________]  ✓  ✕
              ↓ 回车 / ✓ / 失焦
[保存中]  (输入框置灰/loading)
              ↓ API 成功
[显示态]  小明的声音 - 普通话男声  ✏️
```

- 有 description → 显示描述文字 + ✏️ 编辑图标
- 无 description → 显示 voice_id（灰色次要色）+ ✏️ 编辑图标
- 点击 ✕ 或 Escape → 取消编辑，恢复原值
- 失焦 → 自动保存
- 保存失败 → 恢复原值 + toast 提示

**文件改动：**

| 文件 | 改动 |
|------|------|
| `backend/app/models/voice_profile.py` | 新增 `description` 列 |
| `backend/app/api/clone.py` | 新增 `PATCH /{voice_id}/description`；`/list` 返回加 `description` |
| `frontend/src/types/index.ts` | `VoiceProfile` 加 `description?: string` |
| `frontend/src/services/api.ts` | 新增 `voiceApi.updateDescription(id, description)` |
| `frontend/src/components/VoiceClone/VoiceList.tsx` | 内联编辑逻辑 |

#### 1.4 错误处理

| 场景 | 后端 | 前端 |
|------|------|------|
| voice_id 不存在 | 404 | toast + 恢复原值 |
| 数据库错误 | 500 | toast + 恢复原值 |
| 网络超时 | — | 恢复原值 + toast |
| 空字符串 | 转为 NULL | 提交空前视为清除 |

---

## 2. Pitch/Speed 参数校验优化

### 动机

当前 pitch 是 `int [-12, 12]`（半音偏移量），但 Qwen API 底层使用 `pitch_ratio` 参数（比率 float），语义不一致。speed 虽然有前端 slider 限制范围，但后端完全无校验。

### 方案

将 pitch 统一为 float 比率制，speed 和 pitch 共用相同的校验规则：

- 默认值：`1.0`
- 取值范围：`[0.5, 2.0]`
- Pydantic 校验：`Field(ge=0.5, le=2.0, default=1.0)`

#### 2.1 后端变更

| 文件 | 改动 |
|------|------|
| `api/tts.py` | `SynthesizeRequest.pitch` 类型 int → float，加 `Field(ge=0.5, le=2.0)` |
| `api/config.py` | `ConfigCreate.pitch` / `ConfigUpdate.pitch` 类型 int → float，加校验 |
| `models/tts_config.py` | `pitch` 列类型 Integer → Float |
| `models/tts_result.py` | `pitch` 列类型 Integer → Float |
| `services/qwen_tts_service.py` | `pitch` 参数类型 int → float，默认值 0 → 1.0 |

#### 2.2 前端变更

| 文件 | 改动 |
|------|------|
| `types/index.ts` | `pitch` 注释改为 `0.5 - 2.0` |
| `components/TTSSynthesis/ParameterControls.tsx` | pitch slider: min=0.5, max=2.0, step=0.1 |
| `components/TTS/TTSControls.tsx` | pitch slider: min=0.5, max=2.0, step=0.1 |
| `pages/TTSSynthesis.tsx` | pitch 默认值 0 → 1.0 |
| `components/TTS/ModelSelector.tsx` | pitch 默认值 0 → 1.0 |
| `__tests__/*` | 相关测试用例更新默认值 |
| `components/TTSSynthesis/AudioPlayer.tsx` | pitch 显示格式调整 |

---

## 3. 测试要点

- `PATCH /api/clone/{voice_id}/description` 正常设置、更新、清空
- `PATCH /api/clone/{voice_id}/description` 不存在的 voice_id 返回 404
- `GET /api/clone/list` 返回包含 `description` 字段
- Pitch/Speed Pydantic 校验：接受边界值 0.5 和 2.0，拒绝 0.4 和 2.1
- VoiceList 内联编辑：点击编辑、失焦保存、Escape 取消、保存失败恢复
- Pitch slider 前端范围 [0.5, 2.0] 正确渲染