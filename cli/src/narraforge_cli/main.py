"""NarraForge CLI entry point (typer app)."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Optional

import typer

from . import output
from . import segments as segments_mod
from . import voice as voice_mod
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


@project_app.command("set-engine")
def project_set_engine(
    ctx: typer.Context,
    project_id: str,
    engine: str = typer.Argument(
        ..., help="TTS engine: edge_tts / qwen / mimo_tts / voxcpm / indextts."
    ),
    param: list[str] = typer.Option([], "--param", help="Voice param as key=value (repeatable)."),
    chapter_id: Optional[str] = typer.Option(
        None, "--chapter", help="Target one chapter instead of all."
    ),
) -> None:
    """Set the TTS engine (and voice params) on all chapters or one chapter."""

    def run() -> None:
        try:
            voice = voice_mod.build_voice(engine, list(param))
        except ValueError as exc:
            raise NarraForgeCliError(str(exc)) from exc
        detail = ctx.obj.client.get_project(project_id)
        targets = [
            ch
            for ch in detail.get("chapters", [])
            if chapter_id is None or ch.get("id") == chapter_id
        ]
        if not targets:
            raise NarraForgeCliError(
                "no matching chapters" + (f" for --chapter {chapter_id}" if chapter_id else "")
            )
        updated = []
        for ch in targets:
            ctx.obj.client.patch_chapter(project_id, ch["id"], {"voice": voice})
            updated.append({"chapter_id": ch["id"], "name": ch.get("name")})
        result = {"updated": updated, "voice": voice}
        if ctx.obj.json_mode:
            output.emit_json(result)
        else:
            for item in updated:
                typer.echo(f"{item['chapter_id']}\t{item['name']}\t{engine}")

    execute(ctx, run)


segment_app = typer.Typer(no_args_is_help=True, help="Inspect segment status.")
app.add_typer(segment_app, name="segment")


@segment_app.command("list")
def segment_list(
    ctx: typer.Context,
    project_id: str,
    chapter_id: Optional[str] = typer.Option(None, "--chapter"),
    missing_only: bool = typer.Option(False, "--missing-only"),
) -> None:
    """List segments with audio status."""

    def run() -> None:
        detail = ctx.obj.client.get_project(project_id)
        rows = segments_mod.list_rows(detail, chapter_id=chapter_id, missing_only=missing_only)
        if ctx.obj.json_mode:
            output.emit_json({"items": rows, "count": len(rows)})
        else:
            for r in rows:
                status = "ready" if r["ready"] else "MISSING"
                origin = r["origin"] or ""
                typer.echo(
                    f"{r['chapter_name']}\t#{r['position']}\t{status}\t{origin}\t{r['text'][:30]}"
                )

    execute(ctx, run)


@project_app.command("status")
def project_status(ctx: typer.Context, project_id: str) -> None:
    """Show per-chapter audio readiness and export configuration."""

    def run() -> None:
        detail = ctx.obj.client.get_project(project_id)
        rows = []
        for ch in detail.get("chapters", []):
            segs = ch.get("segments", [])
            missing = [s.get("id") for s in segs if not segments_mod.segment_ready(s)]
            rows.append(
                {
                    "chapter_id": ch.get("id"),
                    "name": ch.get("name"),
                    "engine": ((ch.get("voice") or {}).get("engine")),
                    "total": len(segs),
                    "ready": len(segs) - len(missing),
                    "missing_segment_ids": missing,
                }
            )
        result = {
            "id": detail.get("id"),
            "name": detail.get("name"),
            "remotion_project_path": detail.get("remotion_project_path"),
            "export_directory": (detail.get("configs") or {}).get("export_directory"),
            "chapters": rows,
            "all_ready": bool(rows) and all(r["ready"] == r["total"] for r in rows),
        }
        if ctx.obj.json_mode:
            output.emit_json(result)
        else:
            typer.echo(f"project {result['name']}  remotion={result['remotion_project_path']}")
            for r in rows:
                typer.echo(f"{r['name']}\t{r['engine']}\t{r['ready']}/{r['total']} ready")

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
