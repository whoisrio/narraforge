from pydantic_settings import BaseSettings
from pathlib import Path


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

    # 日志配置
    log_level: str = "INFO"  # DEBUG, INFO, WARNING, ERROR, CRITICAL
    log_format: str = "%(asctime)s | %(levelname)-8s | %(name)s | %(funcName)s:%(lineno)d | %(message)s"
    log_to_file: bool = True
    log_file_max_bytes: int = 10 * 1024 * 1024  # 10MB
    log_backup_count: int = 7  # 保留 7 个备份文件

    class Config:
        env_file = ".env"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Ensure directories exist
        self.voices_dir.mkdir(parents=True, exist_ok=True)
        self.videos_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()