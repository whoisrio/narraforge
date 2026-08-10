import logging
import logging.handlers
import os
import re
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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
    - Windows 控制台编码修复：强制 stdout/stderr 使用 UTF-8，
      避免中文在 GBK 终端下显示为乱码
    """

    # ---- Windows 控制台 UTF-8 编码修复 ----
    # 默认情况下，中文 Windows 控制台使用 gbk 编码，
    # Python 的 print/logging 输出的中文会被错解为乱码。
    # PYTHONUTF8=1 是 Python 3.7+ 官方推荐的 Windows UTF-8 模式开关，
    # 同时设置 PYTHONIOENCODING 确保子进程也继承 UTF-8 模式。
    if sys.platform == "win32":
        os.environ.setdefault("PYTHONIOENCODING", "utf-8")
        os.environ.setdefault("PYTHONUTF8", "1")

    # 获取日志级别
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)
    
    # 创建根 logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    # 清除已有的 handler（避免重复）
    root_logger.handlers.clear()
    
    # 创建日志格式器
    formatter = logging.Formatter(settings.log_format)
    
    # 1. 控制台处理器 - 输出到 stdout（使用 UTF-8 包装器）
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

def create_app(deploy_target: str | None = None) -> FastAPI:
    """应用工厂：按部署目标组装 FastAPI 实例。

    - local（默认）：全量路由 + startup/shutdown 事件（init_db + narration
      versioning scheduler），行为与工厂化之前完全一致。
    - workers（Cloudflare Workers / Pyodide）：不注册也不 import 依赖本地
      模型的路由模块（voxcpm、speech_to_text —— 它们间接 import
      faster_whisper/torch），不注册 SQLite 初始化与 scheduler 事件。
    """
    target = deploy_target or settings.deploy_target
    is_local = target == "local"

    app = FastAPI(title=settings.app_name, debug=settings.debug)

    # Cloudflare Access 校验（spec 3.6，仅 workers 模式）：先于 CORS 注册，
    # 使 CORS 成为更外层中间件——Access 拒绝的 401 也带 ACAO 头，
    # 浏览器跨域能读到真实 401 而非 CORS 错误。
    if not is_local and settings.access_enforcement:
        from app.core.access_middleware import AccessEnforcementMiddleware

        app.add_middleware(AccessEnforcementMiddleware)

    # CORS：workers 用 settings.cors_origins（部署填 Pages 域名），local 恒 ["*"]。
    # 注：allow_credentials=True 时规范禁止字面 "*" 配 credentials，Starlette
    # 降级为反射请求 Origin——两种模式下 ACAO 均为具体 origin。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if is_local else list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # TEMP 诊断：定位 GET /api/model-config 洪泛调用来源（诊断完成后删除）
    @app.middleware("http")
    async def _log_model_config_caller(request: Request, call_next):
        if request.url.path.rstrip("/") == "/api/model-config":
            logging.getLogger("diag").info(
                "[diag] model-config caller: ua=%s referer=%s origin=%s",
                request.headers.get("user-agent"),
                request.headers.get("referer"),
                request.headers.get("origin"),
            )
        return await call_next(request)

    if is_local:
        @app.on_event("startup")
        def startup():
            init_db()
            from app.services.narration_versioning.scheduler import start as _start_versioning_scheduler
            _start_versioning_scheduler()

        @app.on_event("shutdown")
        def shutdown():
            from app.services.narration_versioning.scheduler import shutdown as _stop_versioning_scheduler
            _stop_versioning_scheduler()

    # 注：必须 async——Pyodide 不支持线程，sync def 端点在 workers 运行时
    # 会经 anyio.to_thread 失败（冒烟实测）。
    @app.get("/")
    async def root():
        return {"message": "Voice Clone Studio API", "version": "1.0.0"}

    @app.get("/health")
    async def health():
        return {"status": "healthy", "app_env": settings.app_env}

    @app.exception_handler(HTTPException)
    async def structured_http_exception(request: Request, exc: HTTPException):
        """Wrap all HTTPException responses in a consistent {detail: {code, message}} format.

        - Machine codes (snake_case, e.g. 'project_not_found') → used as both
          `code` and `message`.
        - Sentences / raw exception strings → generic status-derived `code`,
          original string as `message`.
        - Already-structured dicts with a 'code' key → passed through.

        The `detail` envelope matches FastAPI's convention so existing frontend
        code reading `response.data.detail` continues to work. The inner object
        now always has `code` + `message` for structured error handling.
        """
        detail = exc.detail
        if isinstance(detail, dict) and "code" in detail:
            inner = detail
        elif isinstance(detail, str):
            code = detail if _is_machine_code(detail) else f"http_{exc.status_code}"
            inner = {"code": code, "message": detail}
        else:
            inner = {"code": f"http_{exc.status_code}", "message": str(detail)}
        headers = getattr(exc, "headers", None)
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": inner},
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def structured_validation_exception(request: Request, exc: RequestValidationError):
        """Wrap Pydantic 422 validation errors in the same {detail: {code, message}} envelope.

        Without this, business 422s return {detail: {code, message}} while Pydantic
        validation 422s return {detail: [{loc, msg, type}, ...]} — an inconsistent
        contract. The handler extracts the first error for a concise message and
        preserves the full list in `errors` for debugging.
        """
        errors = exc.errors()
        # Make errors JSON-serializable (ctx may contain raw exception objects)
        def _clean(obj):
            if isinstance(obj, dict):
                return {k: _clean(v) for k, v in obj.items()}
            if isinstance(obj, (list, tuple)):
                return [_clean(x) for x in obj]
            if isinstance(obj, BaseException):
                return str(obj)
            return obj
        errors = _clean(errors)
        first = errors[0] if errors else {}
        loc = ".".join(str(l) for l in first.get("loc", []))
        msg = first.get("msg", "validation error")
        message = f"{loc}: {msg}" if loc else msg
        return JSONResponse(
            status_code=422,
            content={"detail": {"code": "validation_error", "message": message, "errors": errors}},
        )

    # Import and include routers
    # 注意：speech_to_text / voxcpm 模块间接 import faster_whisper/torch，
    # workers 模式连 import 都不能发生，故 import 放在条件分支内。
    from app.api import clone, tts, config, mimo_tts, subtitle_llm, model_config, text_split, text_analysis, segmented_projects, sources, roles
    if is_local:
        from app.api import speech_to_text, voxcpm

    if is_local:
        # qwen/dashscope/voxcpm 专属端点（依赖 dashscope/qiniu SDK 或本地 GPU），workers 不挂载。
        # 必须先于通用 router 注册：/list-from-qwen、/sync-from-qwen 等具体路径
        # 否则会被 clone.router 的 /{voice_id} 抢先匹配（404 "Voice not found"）。
        app.include_router(clone.local_router, prefix="/api/clone", tags=["voice-clone"])
        app.include_router(tts.local_router, prefix="/api/tts", tags=["tts"])
    app.include_router(clone.router, prefix="/api/clone", tags=["voice-clone"])
    app.include_router(tts.router, prefix="/api/tts", tags=["tts"])
    app.include_router(config.router, prefix="/api/config", tags=["config"])
    if is_local:
        app.include_router(speech_to_text.router, prefix="/api/speech-to-text", tags=["speech-to-text"])
    app.include_router(mimo_tts.router, prefix="/api/mimo-tts", tags=["mimo-tts"])
    app.include_router(subtitle_llm.router, prefix="/api/subtitle-llm", tags=["subtitle-llm"])
    app.include_router(model_config.router, prefix="/api/model-config", tags=["model-config"])
    app.include_router(text_split.router, prefix="/api/text-split", tags=["text-split"])
    app.include_router(text_analysis.router, prefix="/api/text-analysis", tags=["text-analysis"])
    if is_local:
        # ffmpeg/本地 FS/TTS 引擎依赖端点（合成落盘、录音上传、导出、adjust-audio、
        # migrate、项目 ZIP 导出/导入），workers 不挂载（404）。
        # 先于通用 router 注册：/segmented-projects/migrate、/segmented-projects/import
        # 等静态路径保持与拆分前一致的匹配语义。
        app.include_router(segmented_projects.local_router, prefix="/api", tags=["segmented-projects"])
    app.include_router(segmented_projects.router, prefix="/api", tags=["segmented-projects"])
    if is_local:
        app.include_router(voxcpm.router, prefix="/api/voxcpm", tags=["voxcpm"])
    app.include_router(sources.router, prefix="/api", tags=["sources"])
    app.include_router(roles.router, prefix="/api", tags=["roles"])

    return app


# ---- Structured error responses (audit A8) ----
_MACHINE_CODE_RE = re.compile(r"^[a-z][a-z0-9_]*$")

def _is_machine_code(s: str) -> bool:
    """Check if a string is a clean snake_case machine code."""
    return bool(_MACHINE_CODE_RE.match(s))


app = create_app()
