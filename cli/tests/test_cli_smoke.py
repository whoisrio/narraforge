"""Smoke test: the typer app builds and `nf --help` exits 0."""
from typer.testing import CliRunner

from narraforge_cli.main import app


def test_help_succeeds() -> None:
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "NarraForge" in result.output
