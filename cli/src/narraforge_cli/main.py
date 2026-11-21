"""NarraForge CLI entry point (typer app)."""
from __future__ import annotations

from typing import Optional

import typer

from . import output
from .client import Client
from .config import load_config
from .errors import NarraForgeCliError

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Drive the NarraForge backend from the command line.",
)


class Context:
    """Per-invocation state shared by commands."""

    def __init__(self, client: Client, json_mode: bool) -> None:
        self.client = client
        self.json_mode = json_mode


@app.callback()
def main_callback(
    ctx: typer.Context,
    api_url: Optional[str] = typer.Option(
        None, "--api-url", help="Backend base URL (env: NARRAFORGE_API_URL)."
    ),
    json_out: bool = typer.Option(False, "--json", help="Print machine-readable JSON to stdout."),
) -> None:
    output.set_json_mode(json_out)
    ctx.obj = Context(Client(load_config(api_url)), json_out)


def execute(ctx: typer.Context, fn) -> None:
    """Run a command body; map CLI errors to exit codes; always close the client."""
    try:
        fn()
    except NarraForgeCliError as exc:
        output.info(f"error: {exc}")
        raise typer.Exit(exc.exit_code) from exc
    finally:
        ctx.obj.client.close()


@app.command("health")
def health(ctx: typer.Context) -> None:
    """Check backend reachability, deployment target and available engines."""

    def run() -> None:
        data = {
            "health": ctx.obj.client.health(),
            "capabilities": ctx.obj.client.capabilities(),
        }
        caps = data["capabilities"]
        if ctx.obj.json_mode:
            output.emit_json(data)
        else:
            typer.echo(
                f"backend: {data['health'].get('status')} (app_env={data['health'].get('app_env')})"
            )
            typer.echo(f"deploy_target: {caps.get('deploy_target')}")
            typer.echo(f"engines: {', '.join(caps.get('engines', []))}")
            if not (caps.get("features") or {}).get("backend_storage", False):
                output.info(
                    "warning: backend storage disabled - "
                    "project audio persistence and export will not work"
                )

    execute(ctx, run)
