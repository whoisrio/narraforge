"""步骤 1（Cloudflare 部署）：应用工厂化 + DEPLOY_TARGET。

`main.create_app(deploy_target)` 工厂按部署目标分流：
- workers 模式：不注册（也不 import）`voxcpm` / `speech_to_text` 路由，
  不注册 startup/shutdown 事件（init_db + narration versioning scheduler）。
- local 模式：行为与工厂化之前完全一致（全量路由 + startup/shutdown）。

`settings.deploy_target` 默认 "local"，可被 DEPLOY_TARGET 环境变量覆盖。
"""
import asyncio
import inspect
import os
import subprocess
import sys
from pathlib import Path

import pytest

import main as main_module
from app.core.config import Settings, settings


def _route_paths(app) -> set:
    return {route.path for route in app.routes}


# workers / local 两种模式都必须注册的在线路由前缀
_COMMON_PREFIXES = [
    "/api/tts",
    "/api/mimo-tts",
    "/api/config",
    "/api/clone",
    "/api/model-config",
    "/api/text-split",
    "/api/text-analysis",
    "/api/subtitle-llm",
    "/api/roles",
]


# workers 模式不挂载的 qwen/dashscope/voxcpm 端点（完整路径）
_QWEN_ONLY_PATHS = [
    "/api/tts/batch",
    "/api/clone/create-clone",
    "/api/clone/create-clone-voxcpm",
    "/api/clone/list-from-qwen",
    "/api/clone/sync-from-qwen",
]

# workers 模式必须保留的在线端点（完整路径）
_ONLINE_PATHS = [
    "/api/tts/synthesize",
    "/api/clone/create-clone-mimo",
    "/api/clone/upload",
    "/api/clone/create-from-design",
    "/api/clone/list",
]


class TestWorkersApp:
    def test_excludes_local_model_routers(self):
        """workers 模式路由表不含 voxcpm / speech-to-text。"""
        app = main_module.create_app("workers")
        paths = _route_paths(app)
        assert not any(p.startswith("/api/voxcpm") for p in paths)
        assert not any(p.startswith("/api/speech-to-text") for p in paths)

    @pytest.mark.parametrize("path", _QWEN_ONLY_PATHS)
    def test_excludes_qwen_dashscope_endpoints(self, path: str):
        """workers 模式不挂载 tts.py/clone.py 里的 qwen/dashscope/voxcpm 端点。"""
        app = main_module.create_app("workers")
        assert path not in _route_paths(app)

    @pytest.mark.parametrize("path", _ONLINE_PATHS)
    def test_keeps_online_endpoints(self, path: str):
        """workers 模式保留 edge-tts / mimo / 通用 CRUD 端点。"""
        app = main_module.create_app("workers")
        assert path in _route_paths(app)

    @pytest.mark.parametrize("prefix", _COMMON_PREFIXES)
    def test_includes_online_routers(self, prefix: str):
        app = main_module.create_app("workers")
        paths = _route_paths(app)
        assert any(p.startswith(prefix) for p in paths), f"missing routes under {prefix}"

    def test_includes_sources_router(self):
        """sources 路由挂载在 /api 下，路径形如 /api/projects/{id}/sources。"""
        app = main_module.create_app("workers")
        paths = _route_paths(app)
        assert any(p.startswith("/api/projects/") and "/sources" in p for p in paths)

    # 步骤 3B：segmented 元数据端点 workers 必须保留；ffmpeg/本地 FS 端点不挂载
    _SEGMENTED_METADATA_PATHS = [
        "/api/segmented-projects",
        "/api/segmented-projects/{project_id}",
        "/api/segmented-projects/{project_id}/chapters:batch",
        "/api/segmented-projects/{project_id}/apply-animation-spec",
        "/api/segmented-projects/{project_id}/chapters/{chapter_id}/sync-status",
        "/api/segmented-projects/{project_id}/chapters/{chapter_id}/split",
        "/api/segmented-projects/{project_id}/chapters/{chapter_id}/resplit-from-script",
        "/api/segmented-projects/{project_id}/chapters/{chapter_id}/rewrite-script-from-segments",
    ]
    _SEGMENTED_LOCAL_ONLY_PATHS = [
        # synthesize/上传/读取音频已 worker 化（Supabase Storage），workers 挂载
        "/api/segmented-projects/{project_id}/chapters/{chapter_id}/export-audio",
        "/api/segmented-projects/{project_id}/export-all-chapters",
        "/api/segmented-projects/{project_id}/export-text-file-to-remotion",
        "/api/segmented-projects/{project_id}/scaffold-remotion",
        "/api/segmented-projects/{project_id}/chapters/{chapter_id}/adjust-audio",
        "/api/segmented-projects/migrate",
        "/api/segmented-projects/{project_id}/export",
        "/api/segmented-projects/import",
    ]

    _SEGMENTED_WORKERS_MOUNTED_PATHS = [
        "/api/segmented-projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}/synthesize",
        "/api/segmented-projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}/audio",
        "/api/segmented-projects/{project_id}/audio/{chapter_id}/{segment_id}",
    ]

    @pytest.mark.parametrize("path", _SEGMENTED_METADATA_PATHS)
    def test_keeps_segmented_metadata_endpoints(self, path: str):
        app = main_module.create_app("workers")
        assert path in _route_paths(app)

    @pytest.mark.parametrize("path", _SEGMENTED_LOCAL_ONLY_PATHS)
    def test_excludes_segmented_local_only_endpoints(self, path: str):
        app = main_module.create_app("workers")
        assert path not in _route_paths(app)

    @pytest.mark.parametrize("path", _SEGMENTED_WORKERS_MOUNTED_PATHS)
    def test_mounts_segmented_audio_endpoints_in_workers(self, path: str):
        """合成/上传/读取音频端点已 worker 化，workers 模式挂载。"""
        app = main_module.create_app("workers")
        assert path in _route_paths(app)

    @pytest.mark.parametrize("path", _SEGMENTED_METADATA_PATHS + _SEGMENTED_LOCAL_ONLY_PATHS)
    def test_local_mode_keeps_all_segmented_endpoints(self, path: str):
        app = main_module.create_app("local")
        assert path in _route_paths(app)

    def test_no_startup_shutdown_events(self):
        """workers 模式不注册 init_db / scheduler 的 startup、shutdown 事件。"""
        app = main_module.create_app("workers")
        assert app.router.on_startup == []
        assert app.router.on_shutdown == []

    def test_workers_mode_does_not_import_local_ml_modules(self):
        """workers 模式下 import main 不得加载本地 ML 模块与 local-services SDK
        （Pyodide 里没有这些包，连 import 都不能发生）。在干净子进程中验证 sys.modules。
        """
        script = (
            "import sys; import main; "
            "heavy = {'voxcpm', 'faster_whisper', 'funasr', 'torch', 'torchaudio', 'modelscope',"
            "        'edge_tts', 'dashscope', 'qiniu'}; "
            "bad = [m for m in sys.modules "
            "if m.split('.')[0] in heavy "
            "or m in ('app.api.speech_to_text', 'app.api.voxcpm')]; "
            "assert not bad, f'leaked modules: {bad}'"
        )
        env = {**os.environ, "DEPLOY_TARGET": "workers"}
        backend_dir = Path(main_module.__file__).parent
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=backend_dir,
            env=env,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr


class TestLocalApp:
    def test_includes_local_model_routers(self):
        """local 模式路由表包含 voxcpm / speech-to-text。"""
        app = main_module.create_app("local")
        paths = _route_paths(app)
        assert any(p.startswith("/api/voxcpm") for p in paths)
        assert any(p.startswith("/api/speech-to-text") for p in paths)

    @pytest.mark.parametrize("path", _QWEN_ONLY_PATHS)
    def test_includes_qwen_dashscope_endpoints(self, path: str):
        """local 模式全量保留 qwen/dashscope/voxcpm 端点（零回退）。"""
        app = main_module.create_app("local")
        assert path in _route_paths(app)

    @pytest.mark.parametrize("prefix", _COMMON_PREFIXES)
    def test_includes_online_routers(self, prefix: str):
        app = main_module.create_app("local")
        paths = _route_paths(app)
        assert any(p.startswith(prefix) for p in paths), f"missing routes under {prefix}"

    def test_startup_event_calls_init_db(self, monkeypatch):
        """local 模式注册 startup 事件，且事件触发时调用 init_db。"""
        calls = []
        monkeypatch.setattr(main_module, "init_db", lambda: calls.append("init_db"))
        monkeypatch.setattr(
            "app.services.narration_versioning.scheduler.start", lambda: None
        )
        app = main_module.create_app("local")
        assert app.router.on_startup, "local 模式必须注册 startup 事件"
        for handler in app.router.on_startup:
            result = handler()
            if inspect.isawaitable(result):
                asyncio.new_event_loop().run_until_complete(result)
        assert "init_db" in calls


class TestDeployTargetSetting:
    def test_default_deploy_target_is_local(self):
        assert settings.deploy_target == "local"

    def test_deploy_target_env_override(self, monkeypatch):
        """DEPLOY_TARGET 环境变量覆盖默认值。"""
        monkeypatch.setenv("DEPLOY_TARGET", "workers")
        assert Settings().deploy_target == "workers"

    def test_create_app_defaults_to_settings(self, monkeypatch):
        """create_app() 不传参数时读取 settings.deploy_target。"""
        monkeypatch.setattr(settings, "deploy_target", "workers")
        app = main_module.create_app()
        paths = _route_paths(app)
        assert not any(p.startswith("/api/voxcpm") for p in paths)
