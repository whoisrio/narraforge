"""NarraForge CLI entry point (typer app)."""
from __future__ import annotations

import typer

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Drive the NarraForge backend from the command line.",
)


@app.callback()
def main_callback() -> None:
    """NarraForge CLI."""
