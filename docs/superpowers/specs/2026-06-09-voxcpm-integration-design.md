# VoxCPM 本地 GPU 引擎集成设计

## Summary

将 VoxCPM（OpenBMB 开源本地 TTS 模型）作为第四个 TTS 引擎集成到 Voice Clone Studio。
与现有三个云端 API 引擎（Qwen CosyVoice / Edge-TTS / MiMo TTS）不同，VoxCPM 运行在本地 GPU 上，
无需 API Key，支持 Voice Design、Controllable Clone、Ultimate Clone 三种独有模式。

## 目标

- 用户可在 TTS 合成页面选择 VoxCPM 引擎，体验本地推理
- 支持 VoxCPM 三种模式：Voice Design（纯文本描述音色）、Controllable Clone（参考音频克隆）、Ultimate Clone（参考音频+转录最高保真）
- 模型生命周期可控：手动加载/卸载，VRAM 可见
- 与现有引擎共存，互不干扰
- 分段 TTS 支持 VoxCPM 引擎

## 硬件要求

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| GPU VRAM | 8 GB | 12 GB+ |
| 系统内存 | 16 GB | 32 GB |
| CUDA | ≥ 12.0 | 12.x |
| Python | ≥ 3.10, < 3.13 | 3.12 |

模型性能（官方数据，RTX 4090）：

| 模型 | 参数量 | VRAM | RTF | 语言数 |
|------|--------|------|-----|--------|
| VoxCPM2 | 2B | ~8 GB | ~0.30 | 30 |
| VoxCPM1.5 | 0.6B | ~6 GB | ~0.15 | 2 (zh/en) |
| VoxCPM-0.5B | 0.5B | ~5 GB | ~0.17 | 2 (zh/en) |

本方案以 VoxCPM2 为主，VoxCPM1.5 / 0.5B 可通过配置切换。

## 与现有引擎的核心差异

| 维度 | 云端 API 引擎 (Qwen/Edge/MiMo) | VoxCPM (本地) |
|------|-------------------------------|---------------|
| 运行位置 | 远端服务器 | 本地 GPU |
| 认证 | API Key | 无需认证 |
| 模型加载 | 无需加载 | 首次加载 10-30s，占 ~8GB VRAM |
| 推理速度 | 网络延迟为主 | RTF ~0.3（10秒音频≈3秒） |
| 声音克隆 | 注册 voice_id 或传 base64 | 直接传参考音频文件路径 |
| Voice Design | 仅 MiMo 支持 | 原生支持（更强） |
| Ultimate Clone | 不支持 | 支持（参考音频+转录） |
| 费用 | 按量计费 (Qwen/MiMo) | 免费（硬件成本） |
| 语言 | 2-4 种 | 30 种 |

---

## Backend 设计

### 1. 配置层 — `app/core/config.py`

新增以下配置项（全部走 .env，严禁写死）：

```python
# VoxCPM 本地模型配置
voxcpm_model_path: str = "openbmb/VoxCPM2"   # HuggingFace 模型ID 或本地路径
voxcpm_device: str = "auto"                    # auto / cuda / cuda:0 / cpu
voxcpm_dtype: str = "auto"                     # auto / float16 / bfloat16
voxcpm_load_on_start: bool = False             # 启动时自动加载模型
voxcpm_inference_timesteps: int = 10           # 去噪步数（越高质量越好，越慢）
voxcpm_cfg_value: float = 2.0                  # Classifier-Free Guidance 强度
```

.env 示例：
```
VOXCPM_MODEL_PATH=openbmb/VoxCPM2
VOXCPM_DEVICE=auto
VOXCPM_DTYPE=auto
VOXCPM_LOAD_ON_START=false
VOXCPM_INFERENCE_TIMESTEPS=10
VOXCPM_CFG_VALUE=2.0
```

### 2. 服务层 — `app/services/voxcpm_service.py`（新建）

```python
class VoxCPMService:
    """VoxCPM 本地推理服务 — 全局单例，管理模型生命周期"""

    def __init__(self):
        self.model = None           # VoxCPM 模型实例
        self.model_path: str = ""
        self.device: str = "auto"
        self.loaded: bool = False
        self.loading: bool = False

    # ---- 生命周期 ----
    async def load_model(self, model_path: str = None, device: str = None) -> dict:
        """加载模型到 GPU。返回 {success, device, vram_used_mb, load_time_sec}"""

    async def unload_model(self) -> dict:
        """释放 GPU 显存。返回 {success, freed_mb}"""

    def get_status(self) -> dict:
        """返回模型状态: {loaded, loading, device, vram_used_mb, model_path}"""

    # ---- 推理接口 ----
    async def synthesize(
        self,
        text: str,
        mode: str = "tts",                  # tts | design | clone | ultimate
        reference_audio_path: str = None,    # clone/ultimate 模式
        prompt_text: str = None,             # ultimate 模式
        cfg_value: float = None,             # 覆盖默认 CFG
        inference_timesteps: int = None,     # 覆盖默认步数
    ) -> bytes:
        """
        核心合成方法。返回 WAV 音频字节。
        自动检测模式:
        - mode="tts": 纯文本合成（无参考音频）
        - mode="design": Voice Design（text 以 (描述) 开头）
        - mode="clone": Controllable Clone（需要 reference_audio_path）
        - mode="ultimate": Ultimate Clone（需要 reference_audio_path + prompt_text）
        """

    async def synthesize_streaming(
        self,
        text: str,
        mode: str = "tts",
        reference_audio_path: str = None,
        prompt_text: str = None,
        cfg_value: float = None,
        inference_timesteps: int = None,
    ) -> AsyncGenerator[bytes, None]:
        """流式合成，逐 chunk 返回音频"""

    # ---- 内部方法 ----
    def _run_inference_sync(self, **kwargs) -> np.ndarray:
        """同步推理，在 executor 中运行以不阻塞事件循环"""

    def _get_gpu_info(self) -> dict:
        """获取 GPU 显存信息: {total_mb, used_mb, free_mb}"""


# 全局单例
_service: Optional[VoxCPMService] = None

async def get_voxcpm_service() -> VoxCPMService:
    global _service
    if _service is None:
        _service = VoxCPMService()
    return _service
```

关键设计决策：

1. **懒加载** — 默认不在启动时加载模型，首次请求时才加载（可配置 `LOAD_ON_START`）
2. **异步推理** — 使用 `asyncio.get_event_loop().run_in_executor(None, sync_func)` 将同步推理放到线程池
3. **显存管理** — 提供显式 unload 排空 VRAM，避免与 FunASR 冲突
4. **单例** — 全局只保留一个模型实例，重复 load 会先 unload 旧模型

### 3. API 路由 — `app/api/voxcpm.py`（新建）

```python
router = APIRouter()

# ---- 请求模型 ----

class VoxCPMTTSRequest(BaseModel):
    """纯文本 TTS"""
    text: str = Field(..., min_length=1)
    cfg_value: float = Field(default=2.0, ge=1.0, le=5.0)
    inference_timesteps: int = Field(default=10, ge=1, le=50)
    format: str = Field(default="wav")

class VoxCPMDesignRequest(BaseModel):
    """Voice Design — 文本描述生成音色"""
    voice_description: str = Field(..., min_length=1, description="音色描述")
    text: str = Field(default="", description="合成文本（为空时自动生成）")
    cfg_value: float = Field(default=2.0)
    inference_timesteps: int = Field(default=10)
    format: str = Field(default="wav")

class VoxCPMCloneRequest(BaseModel):
    """Controllable Clone"""
    text: str = Field(..., min_length=1)
    voice_id: str = Field(..., description="本地已上传的声音ID")
    style_control: str = Field(default="", description="风格控制描述")
    cfg_value: float = Field(default=2.0)
    inference_timesteps: int = Field(default=10)
    format: str = Field(default="wav")

class VoxCPMUltimateCloneRequest(BaseModel):
    """Ultimate Clone — 最高保真"""
    text: str = Field(..., min_length=1)
    voice_id: str = Field(..., description="本地已上传的声音ID")
    prompt_text: str = Field(..., description="参考音频的转录文本")
    cfg_value: float = Field(default=2.0)
    inference_timesteps: int = Field(default=10)
    format: str = Field(default="wav")

class VoxCPMLoadRequest(BaseModel):
    model_path: str = Field(default="")
    device: str = Field(default="")

# ---- 端点 ----

@router.get("/status")
async def get_status():
    """模型状态: loaded, device, vram_used_mb, model_path"""

@router.post("/load")
async def load_model(request: VoxCPMLoadRequest):
    """加载模型到 GPU（首次约 10-30 秒）"""

@router.post("/unload")
async def unload_model():
    """释放 GPU 显存"""

@router.post("/tts")
async def tts(request: VoxCPMTTSRequest, db: Session = Depends(get_db)):
    """纯文本 TTS 合成"""

@router.post("/design")
async def voice_design(request: VoxCPMDesignRequest, db: Session = Depends(get_db)):
    """Voice Design — 文本描述生成全新音色"""

@router.post("/clone")
async def clone(request: VoxCPMCloneRequest, db: Session = Depends(get_db)):
    """Controllable Clone — 参考音频克隆"""

@router.post("/ultimate-clone")
async def ultimate_clone(request: VoxCPMUltimateCloneRequest, db: Session = Depends(get_db)):
    """Ultimate Clone — 最高保真克隆"""
```

在 `main.py` 注册路由：
```python
from app.api.voxcpm import router as voxcpm_router
app.include_router(voxcpm_router, prefix="/api/voxcpm", tags=["voxcpm"])
```

### 4. 数据模型改造 — `app/models/voice_profile.py`

clone_engine 枚举扩展：
```
现有值: 'qwen', 'mimo', None
新增值: 'voxcpm'
```

VoxCPM 克隆不需要 `qwen_voice_id` 或 `mimo_voice_id`，只需：
- `clone_engine = 'voxcpm'`
- `audio_path` — 本地参考音频路径
- `is_cloned = True`

数据库迁移：
```sql
-- VoxCPM 不需要新增列，复用现有 clone_engine 字段即可
-- 仅需确认 clone_engine 字段已存在
```

### 5. 模型配置 — `app/core/model_config_service.py`

在 `PROVIDER_SCHEMAS` 中新增 `voxcpm` 提供商：

```python
"voxcpm": {
    "model_path": {
        "type": "text",
        "label": "模型路径",
        "description": "HuggingFace 模型 ID 或本地权重目录",
        "default": "openbmb/VoxCPM2",
        "sensitive": False,
    },
    "device": {
        "type": "select",
        "label": "推理设备",
        "options": ["auto", "cuda", "cpu"],
        "default": "auto",
        "sensitive": False,
    },
    "dtype": {
        "type": "select",
        "label": "推理精度",
        "options": ["auto", "float16", "bfloat16"],
        "default": "auto",
        "sensitive": False,
    },
    "inference_timesteps": {
        "type": "number",
        "label": "去噪步数",
        "description": "越高质量越好，越慢。推荐 10",
        "default": 10,
        "sensitive": False,
    },
    "cfg_value": {
        "type": "number",
        "label": "CFG 强度",
        "description": "Classifier-Free Guidance，推荐 2.0",
        "default": 2.0,
        "sensitive": False,
    },
}
```

---

## Frontend 设计

### 1. 类型扩展 — `types/index.ts`

```typescript
// VoiceProfile 扩展
export interface VoiceProfile {
  // ... 现有字段
  clone_engine?: 'qwen' | 'mimo' | 'voxcpm';  // 新增 voxcpm
}

// TTSRequest 扩展
export interface TTSRequest {
  // ... 现有字段
  engine?: 'cosyvoice' | 'edge_tts' | 'mimo_preset' | 'mimo_voicedesign' | 'mimo_voiceclone'
    | 'voxcpm_tts' | 'voxcpm_design' | 'voxcpm_clone' | 'voxcpm_ultimate';
}

// 分段引擎参数扩展
export interface SegmentEngineParams {
  engine: 'cosyvoice' | 'edge_tts' | 'mimo_tts' | 'voxcpm';
  // VoxCPM 专用参数
  voxcpm_mode?: 'tts' | 'design' | 'clone' | 'ultimate';
  voxcpm_voice_description?: string;
  voxcpm_style_control?: string;
  voxcpm_prompt_text?: string;
  voxcpm_cfg_value?: number;
  voxcpm_inference_timesteps?: number;
}

// 新增: VoxCPM 模型状态
export interface VoxCPMStatus {
  loaded: boolean;
  loading: boolean;
  device: string;
  vram_used_mb: number;
  model_path: string;
}
```

### 2. API 客户端 — `services/api.ts`

```typescript
export const voxcpmApi = {
  getStatus: async (): Promise<VoxCPMStatus> => {
    const { data } = await api.get('/voxcpm/status');
    return data;
  },
  loadModel: async (params?: { model_path?: string; device?: string }) => {
    const { data } = await api.post('/voxcpm/load', params || {});
    return data;
  },
  unloadModel: async () => {
    const { data } = await api.post('/voxcpm/unload');
    return data;
  },
  tts: async (params: VoxCPMTTSRequest): Promise<TTSResult> => {
    const { data } = await api.post('/voxcpm/tts', params);
    return data;
  },
  design: async (params: VoxCPMDesignRequest): Promise<TTSResult> => {
    const { data } = await api.post('/voxcpm/design', params);
    return data;
  },
  clone: async (params: VoxCPMCloneRequest): Promise<TTSResult> => {
    const { data } = await api.post('/voxcpm/clone', params);
    return data;
  },
  ultimateClone: async (params: VoxCPMUltimateCloneRequest): Promise<TTSResult> => {
    const { data } = await api.post('/voxcpm/ultimate-clone', params);
    return data;
  },
};
```

### 3. VoxCPM 面板组件 — `components/TTSSynthesis/VoxCPMPanel.tsx`（新建）

面板布局：

```
┌────────────────────────────────────────────────────┐
│ [模型状态] ● 已加载 | GPU: 8.2GB / 12GB | [卸载]   │
│           ○ 未加载                       [加载模型] │
├────────────────────────────────────────────────────┤
│ 模式:  ○ TTS  ○ Voice Design  ○ Clone  ○ Ultimate  │
├────────────────────────────────────────────────────┤
│                                                     │
│  TTS 模式:                                          │
│  ┌─ 文本输入 ──────────────────────────────────┐   │
│  │                                              │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Voice Design 模式:                                 │
│  ┌─ 音色描述 ──────────────────────────────────┐   │
│  │ "年轻女性，温柔甜美"                         │   │
│  └──────────────────────────────────────────────┘   │
│  ┌─ 合成文本 ──────────────────────────────────┐   │
│  │ "你好，欢迎使用 VoxCPM2！"                   │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Clone 模式:                                        │
│  ┌─ 选择参考音频 ──────────────────────────────┐   │
│  │ [下拉: 已上传的声音列表，按 clone_engine 过滤]│   │
│  └──────────────────────────────────────────────┘   │
│  ┌─ 风格控制（可选）───────────────────────────┐   │
│  │ "语速稍快，欢快的语气"                       │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Ultimate 模式:                                     │
│  ┌─ 选择参考音频 ──────────────────────────────┐   │
│  │ [下拉: 已上传的声音列表]                     │   │
│  └──────────────────────────────────────────────┘   │
│  ┌─ 参考音频转录 ──────────────────────────────┐   │
│  │ "这段参考音频的完整文字内容..."               │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│ ┌─ 高级参数（折叠）─────────────────────────────┐  │
│ │ CFG 强度: [2.0]  去噪步数: [10]              │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
│              [合成语音]  ← 按钮，合成中显示进度条   │
└────────────────────────────────────────────────────┘
```

关键交互：
- 模型未加载时，合成按钮置灰，提示"请先加载模型"
- 合成中显示进度动画（因为比 API 引擎慢）
- Clone/Ultimate 模式的声音列表只显示已上传音频的声音（不需要 qwen_voice_id）

### 4. TTSSynthesis 页面集成

引擎选择器扩展：
```
现有: [CosyVoice] [Edge-TTS] [MiMo TTS]
新增: [VoxCPM (本地)]
```

选择 VoxCPM 时渲染 VoxCPMPanel，隐藏其他引擎面板。

### 5. VoiceClone 页面集成

声音克隆区域新增 VoxCPM 选项：
```
现有: [Qwen CosyVoice] [MiMo TTS]
新增: [VoxCPM (本地)]
```

VoxCPM 克隆流程（与现有引擎不同）：
1. 选择参考音频（从已上传列表或新上传）
2. 选择克隆模式: Controllable / Ultimate
3. Ultimate 需填写参考音频的转录文本
4. 可选填写风格控制描述
5. 点击"克隆并试听"
6. 保存到 VoiceProfile 时标记 `clone_engine='voxcpm'`

音色设计区域新增 VoxCPM Voice Design：
- 输入音色描述文本 → 合成试听
- 满意后保存为新 VoiceProfile（`clone_engine='voxcpm'`）

### 6. 分段 TTS 改造

`SegmentEditPanel.tsx` 引擎选项新增 `voxcpm`：
```typescript
const ENGINE_OPTIONS = [
  { value: 'cosyvoice', label: 'CosyVoice' },
  { value: 'edge_tts', label: 'Edge-TTS' },
  { value: 'mimo_tts', label: 'MiMo TTS' },
  { value: 'voxcpm', label: 'VoxCPM (本地)' },  // 新增
];
```

VoxCPM 分段合成参数面板：
- CFG 强度 (slider)
- 去噪步数 (slider)
- 克隆模式选择（如已选择 VoxCPM 声音）

---

## 依赖和环境

### Python 依赖 — `backend/pyproject.toml`

```toml
dependencies = [
    # ... 现有依赖
    "voxcpm",          # VoxCPM TTS 模型
    "soundfile",       # 音频文件读写（VoxCPM 示例依赖）
]
```

### PyTorch GPU 版本

确认 PyTorch 为 GPU 版本（非 CPU-only）：
```bash
# 验证
.venv/Scripts/python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
# 期望: x.x.x+cu124 True
# 如果显示 +cpu 则需要:
uv pip install torch --index-url https://download.pytorch.org/whl/cu124
```

### 模型权重下载

首次加载自动从 HuggingFace 下载 (~4-5GB)。国内加速方案：
```bash
# 方案1: 设置 HuggingFace 镜像
export HF_ENDPOINT=https://hf-mirror.com

# 方案2: 使用 ModelScope 预下载
pip install modelscope
python -c "from modelscope import snapshot_download; snapshot_download('OpenBMB/VoxCPM2', local_dir='./pretrained_models/VoxCPM2')"
# 然后 .env 中设置: VOXCPM_MODEL_PATH=./pretrained_models/VoxCPM2
```

---

## GPU 显存冲突处理

### 问题
VoxCPM 占 ~8GB VRAM，FunASR (Whisper) 也使用 GPU。12GB 显存无法同时运行两者。

### 解决方案
实现显存互斥机制：

```python
# voxcpm_service.py
async def load_model(self):
    # 检查 FunASR 是否占用 GPU
    if self._is_funasr_using_gpu():
        logger.warning("FunASR is using GPU, may cause OOM")
    # 加载 VoxCPM...

# funasr_service.py (改造)
async def transcribe(self, audio_path):
    # 检查 VoxCPM 是否已加载
    voxcpm = await get_voxcpm_service()
    if voxcpm.loaded:
        # 方案A: 临时卸载 VoxCPM → 执行 FunASR → 重新加载
        # 方案B: FunASR 回退到 CPU 模式
        # 方案C: 提示用户手动卸载 VoxCPM
        pass
```

推荐方案 C（用户手动控制），在前端通过状态提示：
- VoxCPM 已加载时，语音识别页面显示黄色提示："VoxCPM 占用 GPU 中，语音识别将使用 CPU 模式（较慢）"
- 语音识别页面增加"释放 GPU"按钮

---

## 超时和性能处理

### 推理超时
VoxCPM 推理比 API 慢，需要调整超时：
- FastAPI 默认超时可能不够
- 使用 `asyncio.wait_for()` 设置合理超时（60-120 秒）
- 前端 Axios 超时也要相应增大

### 分段批量合成
分段 TTS 可能有多段文本，方案：
- **串行合成**（推荐，简单可靠）：逐段合成，每段完成后更新进度
- **并行合成**（高级）：VoxCPM 支持 batch，但需要改造 service 层

### 流式返回
对于长文本，可使用 VoxCPM 的 streaming API：
```python
for chunk in model.generate_streaming(text="长文本..."):
    yield chunk  # SSE 或 WebSocket 推送
```

---

## 实施步骤

### Phase 1: 后端核心 (voxcpm_service.py + config)
1. config.py 添加 VoxCPM 配置项
2. 创建 voxcpm_service.py — 模型加载/卸载/推理
3. 创建 voxcpm API 路由 — status/load/unload/tts/design/clone/ultimate
4. pyproject.toml 添加依赖
5. 验证: curl 测试各端点

### Phase 2: 前端集成
6. types/index.ts 扩展引擎类型
7. services/api.ts 添加 voxcpm API 客户端
8. 创建 VoxCPMPanel.tsx 组件
9. TTSSynthesis.tsx 集成 VoxCPM 引擎选项
10. 验证: 前端能选择 VoxCPM 并合成

### Phase 3: 声音克隆集成
11. VoiceClone.tsx 新增 VoxCPM 克隆流程
12. VoiceClone.tsx 新增 VoxCPM Voice Design
13. voice list 按 clone_engine='voxcpm' 过滤
14. 验证: 完整克隆流程

### Phase 4: 分段 TTS + 优化
15. SegmentEditPanel 引擎选项新增 voxcpm
16. 分段合成参数适配
17. GPU 显存冲突提示
18. model_config_service 添加 voxcpm schema
19. 验证: 分段 TTS 使用 VoxCPM

---

## 风险和注意事项

1. **GPU 显存冲突** — VoxCPM 与 FunASR 无法同时运行，需要互斥机制
2. **首次加载慢** — 模型加载 10-30 秒，需要明确的 loading 状态
3. **推理延迟** — RTF ~0.3，比 API 引擎慢，需要进度反馈
4. **PyTorch GPU 版本** — uv sync 可能安装 CPU-only torch，需要手动切换
5. **模型下载** — 国内访问 HuggingFace 可能很慢，提供 ModelScope 镜像方案
6. **依赖体积** — voxcpm + torch + 模型权重，环境 >10GB
7. **48kHz 输出** — VoxCPM 输出 48kHz，现有引擎多为 16kHz/24kHz，前端播放器需兼容
8. **内存占用** — 推理时除 VRAM 外还会占用系统 RAM（~2-4GB），16GB 内存的机器需注意

---

## 参考资料

- VoxCPM GitHub: https://github.com/OpenBMB/VoxCPM
- VoxCPM2 权重: https://huggingface.co/openbmb/VoxCPM2
- VoxCPM2 ModelScope: https://modelscope.cn/models/OpenBMB/VoxCPM2
- Nano-vLLM 加速: https://github.com/a710128/nanovllm-voxcpm
- vLLM-Omni 部署: https://github.com/vllm-project/vllm-omni
- VoxCPM 文档: https://voxcpm.readthedocs.io/en/latest/
