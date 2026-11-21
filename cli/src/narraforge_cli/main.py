"""NarraForge CLI entry point (typer app)."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
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
project_app = typer.Typer(no_args_is_help=True, help="Manage segmented projects.")
app.add_typer(project_app, name="project")


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


@project_app.command("list")
def project_list(ctx: typer.Context) -> None:
    """List projects (lightweight summaries)."""

    def run() -> None:
        items = ctx.obj.client.list_projects()
        if ctx.obj.json_mode:
            output.emit_json({"items": items})
        else:
            for p in items:
                typer.echo(f"{p.get('id')}\t{p.get('name')}\t{p.get('updated_at', '')}")

    execute(ctx, run)


@project_app.command("get")
def project_get(ctx: typer.Context, project_id: str) -> None:
    """Print the full project detail (JSON)."""

    def run() -> None:
        detail = ctx.obj.client.get_project(project_id)
        if ctx.obj.json_mode:
            output.emit_json(detail)
        else:
            typer.echo(json.dumps(detail, ensure_ascii=False, indent=2))

    execute(ctx, run)


@project_app.command("create")
def project_create(
    ctx: typer.Context,
    name: str = typer.Option(..., "--name", help="Project name."),
    script: Optional[Path] = typer.Option(
        None, "--script", help="Path to the narration script markdown file."
    ),
    remotion_path: Optional[str] = typer.Option(
        None, "--remotion-path", help="Remotion project directory to store on the project."
    ),
) -> None:
    """Create a project and optionally attach the narration script."""

    def run() -> None:
        client = ctx.obj.client
        project_id = str(uuid.uuid4())
        payload = {
            "id": project_id,
            "name": name,
            "schema_version": 2,
            "layout": "vertical",
            "configs": {},
        }
        detail = client.create_project(payload)
        narration_path = None
        if script is not None:
            text = script.read_text(encoding="utf-8")
            put = client.put_narration_script(project_id, text)
            narration_path = put.get("path")
        if remotion_path is not None:
            detail = client.patch_project(project_id, {"remotion_project_path": remotion_path})
        result = {
            "id": project_id,
            "name": detail.get("name"),
            "narration_script_path": narration_path,
            "remotion_project_path": detail.get("remotion_project_path"),
        }
        if ctx.obj.json_mode:
            output.emit_json(result)
        else:
            typer.echo(f"created project {project_id} ({name})")

    execute(ctx, run)


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
