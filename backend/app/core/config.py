import os
import re
from pydantic_settings import BaseSettings
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
    # App
    app_name: str = "Voice Clone Studio"
    debug: bool = True

    # Paths
    base_dir: Path = Path(__file__).parent.parent.parent
    uploads_dir: Path = base_dir / "uploads"
    voices_dir: Path = uploads_dir / "voices"
    videos_dir: Path = uploads_dir / "videos"
    logs_dir: Path = base_dir / "logs"

    # Database
    database_url: str = "sqlite:///./voice_clone.db"

    # API Keys (千问)
    qwen_api_key: str = ""
    qwen_model: str = "qwen-tts"

    # 公网访问 URL（CosyVoice 声音注册需要公网可访问的音频 URL）
    # 本地开发可以使用 ngrok 暴露的 URL，如：https://xxxx.ngrok.io
    # 生产环境使用实际域名，如：https://your-domain.com
    public_base_url: str = ""

    # 日志配置
    log_level: str = "INFO"  # DEBUG, INFO, WARNING, ERROR, CRITICAL
    log_format: str = "%(asctime)s | %(levelname)-8s | %(name)s | %(funcName)s:%(lineno)d | %(message)s"
    log_to_file: bool = True
    log_file_max_bytes: int = 10 * 1024 * 1024  # 10MB
    log_backup_count: int = 7  # 保留 7 个备份

    class Config:
        env_file = ".env"

    def __init__(self, **kwargs):
        # 预处理 .env 值中的环境变量引用
        env_values = self._load_env_with_refs()
        merged = {**env_values, **kwargs}
        super().__init__(**merged)
        # Ensure directories exist
        self.voices_dir.mkdir(parents=True, exist_ok=True)
        self.videos_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    def _load_env_with_refs(cls) -> dict:
        """读取 .env 文件并解析 ${ENV_VAR} 引用"""
        env_file = Path(cls.Config.env_file)
        if not env_file.exists():
            return {}

        result = {}
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if _ENV_VAR_PATTERN.search(value):
                value = _resolve_env_refs(value)
            result[key.lower()] = value
        return result


settings = Settings()
