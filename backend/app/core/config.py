import os
import re
from pydantic_settings import BaseSettings, SettingsConfigDict
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


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_name: str = "NarraForge"
    app_env: str = "production"   # production | e2e (set by .env.e2e overlay)
    debug: bool = True

    # Paths
    base_dir: Path = Path(__file__).parent.parent.parent
    uploads_dir: Path = base_dir / "uploads"
    voices_dir: Path = uploads_dir / "voices"
    videos_dir: Path = uploads_dir / "videos"
    srt_output_dir: Path = uploads_dir / "srt"
    segmented_dir: Path = uploads_dir / "segmented"
    output_dir: Path = base_dir / "output"
    clone_voices_dir: Path = output_dir / "clone_voices"
    logs_dir: Path = base_dir / "logs"

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

    # API Keys (千问)
    qwen_api_key: str = ""
    qwen_model: str = "qwen-tts"

    # MiMo TTS API (小米 MiMo-V2.5-TTS 系列)
    mimo_api_key: str = ""
    mimo_base_url: str = "https://api.xiaomimimo.com/v1"

    # FunASR 本地语音识别
    funasr_model: str = "paraformer-zh"  # paraformer-zh / paraformer-zh-streaming
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
        self.voices_dir.mkdir(parents=True, exist_ok=True)
        self.videos_dir.mkdir(parents=True, exist_ok=True)
        self.srt_output_dir.mkdir(parents=True, exist_ok=True)
        self.segmented_dir.mkdir(parents=True, exist_ok=True)
        self.clone_voices_dir.mkdir(parents=True, exist_ok=True)
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
