"""步骤 5（bundle 瘦身）：workers 部署不 vendor sqlalchemy（~8.5MB，最大头），
ORM 只走 Supabase/PostgREST。因此 workers 模式的 import 闭包里不得出现
sqlalchemy / app.models 的顶层 import——否则部署后 worker 启动即 ImportError。

本测试在子进程里用 meta_path 拦截器屏蔽 sqlalchemy 与 app.models（模拟
Pyodide bundle 中二者不存在），断言 workers 应用仍可完整构建（路由注册
需要 FastAPI 解析所有端点签名）。
"""
import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent

_BLOCK_SQLALCHEMY = (
    "import sys\n"
    "class _B:\n"
    "    def find_spec(self, name, path=None, target=None):\n"
    "        if (name == 'sqlalchemy' or name.startswith('sqlalchemy.')\n"
    "                or name == 'app.models' or name.startswith('app.models.')):\n"
    "            raise ImportError(f'blocked: {name}')\n"
    "    \n"
    "sys.meta_path.insert(0, _B())\n"
)


def _run_subprocess(script: str, deploy_target: str = "workers") -> subprocess.CompletedProcess:
    env = {**os.environ, "DEPLOY_TARGET": deploy_target}
    return subprocess.run(
        [sys.executable, "-c", script],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


class TestWorkersImportableWithoutSqlalchemy:
    def test_workers_app_builds_without_sqlalchemy(self):
        """无 sqlalchemy/app.models 时 create_app('workers') 必须成功。"""
        result = _run_subprocess(
            _BLOCK_SQLALCHEMY
            + "import main\n"
            "app = main.create_app('workers')\n"
            "assert len(app.routes) > 10\n",
        )
        assert result.returncode == 0, result.stderr

    def test_workers_route_registration_resolves_type_hints(self):
        """FastAPI 路由注册会 get_type_hints 解析端点签名：
        注解里的 Session 在无 sqlalchemy 时必须可解析（守卫为 Any）。"""
        result = _run_subprocess(
            _BLOCK_SQLALCHEMY
            + "import main\n"
            "app = main.create_app('workers')\n"
            "for route in app.routes:\n"
            "    dependant = getattr(route, 'dependant', None)\n"
            "    assert dependant is None or dependant.call is not None\n",
        )
        assert result.returncode == 0, result.stderr


class TestLocalStillImportsSqlalchemy:
    def test_local_app_builds_with_sqlalchemy(self):
        """local 模式零回退：sqlalchemy 正常导入，engine 可用。"""
        result = _run_subprocess(
            "import main\n"
            "app = main.create_app('local')\n"
            "import sqlalchemy\n"
            "assert sqlalchemy.__version__\n"
            "assert len(app.routes) > 10\n",
            "local",
        )
        assert result.returncode == 0, result.stderr
