import logging
import logging.handlers
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import init_db


def setup_logging():
    """
    配置日志系统
    
    为什么需要这个配置：
    - 统一的日志格式，便于问题排查
    - 同时输出到控制台和文件
    - 文件按大小轮转，避免单个文件过大
    - 通过环境变量控制日志级别
    """
    # 获取日志级别
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)
    
    # 创建根 logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    # 清除已有的 handler（避免重复）
    root_logger.handlers.clear()
    
    # 创建日志格式器
    formatter = logging.Formatter(settings.log_format)
    
    # 1. 控制台处理器 - 输出到 stdout
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # 2. 文件处理器 - 输出到文件（按大小轮转）
    if settings.log_to_file:
        log_file = settings.logs_dir / "app.log"
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=settings.log_file_max_bytes,  # 单个文件最大 10MB
            backupCount=settings.log_backup_count,  # 保留 7 个备份文件
            encoding="utf-8"
        )
        file_handler.setLevel(log_level)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
        
        # 记录日志配置信息
        logging.getLogger(__name__).info(
            f"Logging configured: level={settings.log_level}, "
            f"log_file={log_file}, "
            f"max_bytes={settings.log_file_max_bytes}, "
            f"backup_count={settings.log_backup_count}"
        )


# 在应用启动前初始化日志
setup_logging()

app = FastAPI(title=settings.app_name, debug=settings.debug)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


@app.get("/")
def root():
    return {"message": "Voice Clone Studio API", "version": "1.0.0"}


@app.get("/health")
def health():
    return {"status": "healthy"}


# Import and include routers
from app.api import clone, tts, config

app.include_router(clone.router, prefix="/api/clone", tags=["voice-clone"])
app.include_router(tts.router, prefix="/api/tts", tags=["tts"])
app.include_router(config.router, prefix="/api/config", tags=["config"])