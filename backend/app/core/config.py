import os
import re
from typing import Annotated

from pydantic import BeforeValidator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from pathlib import Path

# 匹配 ${ENV_VAR} 或 ${ENV_VAR:-default} 格式
_ENV_VAR_PATTERN = re.compile(r"\$\{([^}]+)\}")


def _resolve_env_refs(value: str) -> str:
    """解析字符串中的 ${ENV_VAR} 和 ${ENV_VAR:-default} 引用"""
    def _replace(match: re.Match) -> str:
        expr = match.group(1)
        if ":-" in expr:
            var_name, default = expr.split(":-", 1)
            return os.environ.get(var_name.strip(), default)
        return os.environ.get(expr.strip(), "")

    return _ENV_VAR_PATTERN.sub(_replace, value)


def _split_csv(value):
    """逗号分隔字符串 → list[str]（CORS_ORIGINS 环境变量/.env/[vars] 用）。"""
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_name: str = "NarraForge"
    app_env: str = "production"   # production | e2e (set by .env.e2e overlay)
    debug: bool = True
    # 部署目标：local（本地全量，含本地模型路由/SQLite/scheduler）| workers（Cloudflare Workers，纯在线路由）
    deploy_target: str = "local"

    # Cloudflare Access 头校验（spec 3.6；仅 workers 模式注册中间件，local 完全不启用）
    access_enforcement: bool = True
    # 网关共享密钥（HF Spaces 部署：CF Worker 网关注入 X-Narraforge-Gateway-Secret，
    # Space 私有、无 Access 边缘注入邮箱头；空串 = 关闭该凭证通道，仅认 Access 邮箱头）
    gateway_secret: str = ""
    # Bearer 共享口令（无域名 Vercel + Pages 直连部署：前端解锁页持有口令，请求带
    # Authorization: Bearer <token>；空串 = 关闭该凭证通道）
    access_token: str = ""
    # CORS 允许来源（仅 workers 模式生效，部署时填 Pages 域名；local 恒为 ["*"]，见 main.create_app）。
    # 环境变量/[vars] 用逗号分隔；NoDecode 关闭 pydantic-settings 的 JSON 解码，交 BeforeValidator 拆分。
    cors_origins: Annotated[list[str], NoDecode, BeforeValidator(_split_csv)] = ["*"]

    # Paths
    base_dir: Path = Path(__file__).parent.parent.parent
    data_dir: Path = base_dir / "data"
    uploads_dir: Path = base_dir / "uploads"  # legacy (PR-B 收敛到 data/ 后废弃)
    videos_dir: Path = uploads_dir / "videos"
    # 项目资产根（原 uploads/segmented）。DB 中的 audio.path 均相对此目录。
    segmented_dir: Path = data_dir / "projects"
    # 音色库（原 uploads/voices + output/clone_voices 两处合并）
    voices_profiles_dir: Path = data_dir / "voices" / "profiles"   # 克隆样本原音
    voices_previews_dir: Path = data_dir / "voices" / "previews"   # 克隆/引擎试听
    voices_dir: Path = uploads_dir / "voices"  # legacy：历史样本/TTS 历史音频，迁移后仅作回退读取
    tts_history_dir: Path = data_dir / "tts-history"  # TTS 历史音频（合并 voices/tts_* 与 uploads/tts_results）
    srt_output_dir: Path = data_dir / "srt"
    temp_dir: Path = data_dir / "temp"
    output_dir: Path = base_dir / "output"  # legacy（PR-B 收敛后废弃）
    clone_voices_dir: Path = output_dir / "clone_voices"  # legacy alias，迁移后由 voices_previews_dir 取代
    logs_dir: Path = base_dir / "logs"

    @property
    def projects_dir(self) -> Path:
        """Alias for segmented_dir (unified data root naming)."""
        return self.segmented_dir

    def to_relative(self, abs_path: str | Path) -> str:
        """绝对路径 → 相对路径（相对于 base_dir）"""
        p = Path(abs_path)
        try:
            return str(p.relative_to(self.base_dir)).replace("\\", "/")
        except ValueError:
            return str(p).replace("\\", "/")

    def resolve_path(self, rel_path: str | Path) -> Path:
        """相对路径 → 绝对路径（拼接 base_dir）"""
        p = Path(rel_path)
        if p.is_absolute():
            return p
        return self.base_dir / p

    # Database
    database_url: str = "sqlite:///./voice_clone.db"

    # Supabase（workers 模式持久化：PostgREST REST 访问，service key 只在后端）
    supabase_url: str = ""
    supabase_service_key: str = ""
    # Supabase Storage 资产桶（workers 模式无 R2 binding 时的二进制资产后端，如 Render）
    supabase_storage_bucket: str = "voice-assets"
    # 二进制资产存储后端：auto | local | r2 | supabase
    # auto：local 模式→本地文件系统；workers 模式→有 R2 binding 用 R2（真 Workers），
    # 否则 Supabase Storage（Render 等无 binding 的 CPython 部署）。显式值可覆盖。
    asset_store_backend: str = "auto"

    # 出站 HTTP 调用超时（秒）：mimo TTS 等上游 API。
    # 默认 120s 保持本地行为不变；workers 模式经 get_upstream_timeout() Cap 到
    # WORKERS_UPSTREAM_TIMEOUT_CAP（Vercel Hobby fluid 函数上限 300s − 50s 余量）。
    upstream_timeout_seconds: float = 120.0

    # API Keys (千问)
    qwen_api_key: str = ""
    qwen_model: str = "qwen-tts"

    # MiMo TTS API (小米 MiMo-V2.5-TTS 系列)
    mimo_api_key: str = ""
    mimo_base_url: str = "https://api.xiaomimimo.com/v1"

    # FunASR 本地语音识别
    funasr_model: str = "paraformer-zh"  # 仅离线模型；流式模型不支持字幕转写
    funasr_device: str = ""  # 留空自动检测 (cuda > mps > cpu)

    # LLM 字幕校准/翻译（默认复用 MiMo 配置）
    llm_api_key: str = ""           # 留空则自动回退到 mimo_api_key
    llm_base_url: str = ""          # 留空则自动回退到 mimo_base_url
    llm_model: str = "mimo-v2.5-pro"

    # Agent LLM（工作流脚本生成/审查/拆分等非 TTS 功能，留空则回退到 llm_* 配置）
    agent_llm_api_key: str = ""
    agent_llm_base_url: str = ""
    agent_llm_model: str = ""

    # 公网访问 URL（CosyVoice 声音注册需要公网可访问的音频 URL）
    # 本地开发可以使用 ngrok 暴露的 URL，如：https://xxxx.ngrok.io
    # 生产环境使用实际域名，如：https://your-domain.com
    public_base_url: str = ""

    # 七牛云对象存储
    oss_ak: str = ""
    oss_sk: str = ""
    bucket_name: str = ""
    bucket_domain: str = ""

    # VoxCPM 本地 GPU 模型
    voxcpm_model_path: str = "openbmb/VoxCPM2"   # HuggingFace 模型ID 或本地权重目录
    voxcpm_device: str = "auto"                    # auto / cuda / cuda:0 / cpu
    voxcpm_dtype: str = "auto"                     # auto / float16 / bfloat16
    voxcpm_load_on_start: bool = False             # 启动时自动加载模型
    voxcpm_inference_timesteps: int = 10           # 去噪步数（越高质量越好，越慢）
    voxcpm_cfg_value: float = 2.0                  # Classifier-Free Guidance 强度

    # 配置加密密钥（Fernet 对称加密，首次启动自动生成）
    config_encryption_key: str = ""

    # 日志配置
    log_level: str = "INFO"  # DEBUG, INFO, WARNING, ERROR, CRITICAL
    log_format: str = "%(asctime)s | %(levelname)-8s | %(name)s | %(funcName)s:%(lineno)d | %(message)s"
    log_to_file: bool = True
    log_file_max_bytes: int = 10 * 1024 * 1024  # 10MB
    log_backup_count: int = 7  # 保留 7 个备份

    def __init__(self, **kwargs):
        # 预处理 .env 值中的环境变量引用
        env_values = self._load_env_with_refs()
        merged = {**env_values, **kwargs}
        super().__init__(**merged)
        # Ensure directories exist
        # workers 运行时（Pyodide）FS 只读且无持久性，跳过本地目录创建
        if self.deploy_target == "workers":
            return
        self.videos_dir.mkdir(parents=True, exist_ok=True)
        self.srt_output_dir.mkdir(parents=True, exist_ok=True)
        self.segmented_dir.mkdir(parents=True, exist_ok=True)
        self.voices_profiles_dir.mkdir(parents=True, exist_ok=True)
        self.voices_previews_dir.mkdir(parents=True, exist_ok=True)
        self.tts_history_dir.mkdir(parents=True, exist_ok=True)
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    def _load_env_with_refs(cls) -> dict:
        """读取 .env 文件并解析 ${ENV_VAR} 引用。
        
        加载顺序：
        1. 先加载 .env（生产配置）
        2. 如果设置了 ENV_FILE 环境变量（如 ENV_FILE=.env.e2e），叠加加载该文件，
           覆盖同名 key。用于 E2E 测试环境隔离（如使用独立的测试数据库）。"""
        configured_env_file = cls.model_config.get("env_file") or ".env"
        if isinstance(configured_env_file, (list, tuple)):
            configured_env_file = configured_env_file[0] if configured_env_file else ".env"
        if not isinstance(configured_env_file, (str, Path)):
            configured_env_file = ".env"

        # Load base .env first
        result: dict[str, str] = {}
        base_env = Path(configured_env_file)
        if base_env.exists():
            result = cls._parse_env_file(base_env)

        # If ENV_FILE is set, load it as an overlay (overrides base .env values)
        overlay_name = os.environ.get("ENV_FILE")
        if overlay_name:
            overlay_path = Path(overlay_name)
            if overlay_path.exists():
                overlay = cls._parse_env_file(overlay_path)
                result.update(overlay)  # overlay keys win

        return result

    @staticmethod
    def _parse_env_file(env_file: Path) -> dict[str, str]:
        """Parse a single .env file and resolve ${ENV_VAR} references."""
        result: dict[str, str] = {}
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            # 去除行内注释（# 及其后的内容），避免注释文本被误当作值的一部分
            if "#" in value:
                value = value.split("#")[0].strip()
            if _ENV_VAR_PATTERN.search(value):
                value = _resolve_env_refs(value)
            result[key.lower()] = value
        return result


settings = Settings()

# Vercel Hobby（fluid compute，2026-08 官方文档核实）函数时长上限 300s；
# workers 部署的出站超时收敛到该上限减 50s 平台余量，避免请求被平台硬杀。
# 若部署环境函数上限更低（如无 fluid 的旧 Hobby 60s），用
# UPSTREAM_TIMEOUT_SECONDS 环境变量进一步调低即可（min 语义自动生效）。
WORKERS_UPSTREAM_TIMEOUT_CAP = 250.0


def get_upstream_timeout() -> float:
    """出站 HTTP 调用有效超时：workers 模式 Cap 到平台函数时长上限内。"""
    if settings.deploy_target == "workers":
        return min(settings.upstream_timeout_seconds, WORKERS_UPSTREAM_TIMEOUT_CAP)
    return settings.upstream_timeout_seconds
