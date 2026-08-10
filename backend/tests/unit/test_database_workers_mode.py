"""步骤 3A（Cloudflare 部署）：workers 模式下 SQLAlchemy engine 延迟化。

约束：
- local 模式行为零回退：engine 首次访问时创建，PRAGMA foreign_keys 照旧注册。
- workers 模式（Pyodide 无原生 socket）：import `app.core.database` 不得创建
  engine；任何代码路径触碰 engine 必须立刻报清晰错误（说明应走 Supabase 仓储）。
- `get_db` 在 workers 模式 yield None：workers 保留路由中尚未迁移到仓储的
  端点一旦触碰 db 会立即失败，而已迁移端点（通过仓储依赖）不受影响。
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


def _run_subprocess(script: str, deploy_target: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DEPLOY_TARGET": deploy_target}
    return subprocess.run(
        [sys.executable, "-c", script],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


class TestWorkersModeEngineDeferred:
    def test_import_does_not_create_engine(self):
        """workers 模式 import database 模块后 engine 仍未创建。"""
        result = _run_subprocess(
            "import app.core.database as d; assert d._engine is None, 'engine created at import'",
            "workers",
        )
        assert result.returncode == 0, result.stderr

    def test_get_engine_raises_in_workers(self):
        """workers 模式访问 engine 必须报清晰错误，而不是静默建 SQLite 文件。"""
        result = _run_subprocess(
            "import app.core.database as d\n"
            "try:\n"
            "    d.get_engine()\n"
            "except RuntimeError as e:\n"
            "    assert 'workers' in str(e)\n"
            "else:\n"
            "    raise AssertionError('get_engine did not raise')\n",
            "workers",
        )
        assert result.returncode == 0, result.stderr

    def test_workers_app_does_not_create_engine(self):
        """workers 模式建 app + 触发路由注册后 engine 仍未创建。"""
        result = _run_subprocess(
            "import main; main.create_app('workers'); "
            "import app.core.database as d; assert d._engine is None",
            "workers",
        )
        assert result.returncode == 0, result.stderr

    def test_get_db_yields_none_in_workers(self, monkeypatch):
        """get_db 在 workers 模式 yield None（不触碰 engine）。"""
        monkeypatch.setattr(settings, "deploy_target", "workers")
        from app.core.database import get_db

        gen = get_db()
        assert next(gen) is None
        with pytest.raises(StopIteration):
            next(gen)


class TestLocalModeUnchanged:
    def test_get_engine_creates_engine_lazily(self):
        """local 模式首次访问创建 engine（子进程隔离验证）。"""
        result = _run_subprocess(
            "import app.core.database as d\n"
            "assert d._engine is None\n"
            "engine = d.get_engine()\n"
            "assert engine is d.get_engine()  # cached\n"
            "from sqlalchemy import text\n"
            "with engine.connect() as conn:\n"
            "    assert conn.execute(text('PRAGMA foreign_keys')).scalar() == 1\n",
            "local",
        )
        assert result.returncode == 0, result.stderr

    def test_module_level_engine_attr_still_works(self):
        """历史代码 `from app.core.database import engine`（模块级属性）保持可用。"""
        result = _run_subprocess(
            "from app.core.database import engine, SessionLocal\n"
            "assert engine is not None and SessionLocal is not None\n",
            "local",
        )
        assert result.returncode == 0, result.stderr

    def test_get_db_yields_session_in_local(self, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "local")
        from app.core.database import get_db

        gen = get_db()
        db = next(gen)
        assert db is not None
        gen.close()
