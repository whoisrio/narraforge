"""V1（Vercel 适配）：部署配置静态校验，防漂移。

- vercel.json 的 functions 键必须指向真实存在且导出 FastAPI `app` 的入口文件，
  maxDuration 不得超过 Hobby（fluid compute）上限 300s（2026-08 官方文档核实）。
- .vercelignore 必须排除测试/数据/虚拟环境等目录（Python bundle 上限 500MB）。
- pyproject 的 vercel-deploy 依赖组必须列入 tool.uv.default-groups：
  Vercel Python 构建跑 `uv sync --active --no-dev --link-mode hardlink`
  （无 --extra 入口，见 vercel/vercel packages/python/src/uv.ts），
  只安装 [project.dependencies] + 默认依赖组；edge-tts 由此进入部署环境。
"""
import json
import logging
import tomllib
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent


class TestVercelJson:
    def _config(self) -> dict:
        path = BACKEND_ROOT / "vercel.json"
        assert path.exists(), "backend/vercel.json 缺失"
        return json.loads(path.read_text(encoding="utf-8"))

    def test_functions_entrypoint_exists_and_exports_app(self):
        config = self._config()
        functions = config.get("functions") or {}
        assert len(functions) == 1, "workers 模式应为单函数应用"
        entrypoint_rel, fn_config = next(iter(functions.items()))
        entrypoint = BACKEND_ROOT / entrypoint_rel
        assert entrypoint.exists(), f"vercel.json 引用的入口文件不存在: {entrypoint_rel}"
        assert fn_config.get("maxDuration", 0) <= 300, "Hobby（fluid）maxDuration 上限 300s"
        assert fn_config.get("maxDuration", 0) >= 60

        import importlib
        import sys

        sys.path.insert(0, str(BACKEND_ROOT))
        try:
            module = importlib.import_module(entrypoint.stem)
        finally:
            sys.path.pop(0)
        assert hasattr(module, "app"), f"{entrypoint_rel} 必须导出 FastAPI app 实例"

    def test_no_api_directory_per_file_functions(self):
        """不走 /api 目录每文件一函数的约定（我们要的是单函数 FastAPI 应用）。"""
        assert not (BACKEND_ROOT / "api").exists(), (
            "backend/api/ 会触发 Vercel 每文件一函数约定，入口应为根级 main.py"
        )


    def test_pyproject_entrypoint_resolves_if_configured(self):
        """[tool.vercel] entrypoint 若存在，模块路径必须相对 Root Directory（backend/）可解析。

        Vercel 把 entrypoint 解析为 ./<module 路径>.py（相对项目根，即 backend/）。
        写 "backend.main:app" 会被解析成 backend/backend/main.py 导致构建报错；
        Root Directory=backend 时 main.py 本就在默认探测列表，该配置应省略。
        """
        pyproject = tomllib.loads((BACKEND_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
        entrypoint = (pyproject.get("tool", {}).get("vercel") or {}).get("entrypoint")
        if entrypoint is None:
            return  # 未配置时走默认探测（main.py 在根级列表内），合法
        module_path = entrypoint.split(":")[0].replace(".", "/") + ".py"
        assert (BACKEND_ROOT / module_path).exists(), (
            f"[tool.vercel] entrypoint={entrypoint} 解析为 {module_path}，"
            f"相对 Root Directory（backend/）不存在"
        )


class TestVercelIgnore:
    def test_excludes_heavy_local_dirs(self):
        path = BACKEND_ROOT / ".vercelignore"
        assert path.exists(), "backend/.vercelignore 缺失"
        content = path.read_text(encoding="utf-8")
        for pattern in ("tests/", "data/", ".venv/", "logs/", "uploads/", "output/"):
            assert pattern in content, f".vercelignore 缺少排除项: {pattern}"


class TestPyprojectVercelDeps:
    def test_vercel_deploy_group_in_default_groups(self):
        pyproject = tomllib.loads((BACKEND_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
        groups = pyproject.get("dependency-groups") or {}
        vercel_group = groups.get("vercel-deploy") or []
        assert any(dep.split(">=")[0].split("==")[0] == "edge-tts" for dep in vercel_group), (
            "vercel-deploy 依赖组必须含 edge-tts（workers 模式 CPython 回退）"
        )
        default_groups = (pyproject.get("tool", {}).get("uv") or {}).get("default-groups") or []
        assert "vercel-deploy" in default_groups, (
            "vercel-deploy 必须在 tool.uv.default-groups 中，否则 Vercel 的 "
            "`uv sync --no-dev` 不会安装 edge-tts"
        )


class TestSetupLoggingServerless:
    def test_setup_logging_tolerates_readonly_fs(self, monkeypatch, tmp_path):
        """serverless 只读文件系统（Vercel）：日志文件打不开时降级为仅控制台，不得崩溃。"""
        import main as main_module
        from app.core.config import settings

        monkeypatch.setattr(settings, "log_to_file", True)
        monkeypatch.setattr(settings, "logs_dir", tmp_path / "nonexistent" / "readonly")
        main_module.setup_logging()  # 不应抛 OSError
        assert logging.getLogger().handlers, "至少应保留控制台 handler"
