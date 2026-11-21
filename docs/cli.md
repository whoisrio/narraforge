# NarraForge CLI (`nf`)

A thin command-line client that drives the NarraForge backend over HTTP to execute
the narration workflow end to end: create project → paste narration → split →
select engine → synthesize → export audio into a Remotion project.

The CLI is a pure HTTP client of the backend API — no direct database access,
no business-logic duplication. Lives in `cli/` (own uv environment, deps:
`typer` + `httpx`).

## Requirements

- **A running NarraForge backend** (default `http://127.0.0.1:8002`). The frontend
  and the LangGraph agent service are not required — the CLI talks to the backend
  directly. `nf health` exits with code `2` when the backend is unreachable; start
  the backend with `cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002`.
- Engine availability depends on the engine: `edge_tts` needs only internet access
  (no API keys / GPU); `mimo_tts` / `qwen` need API keys; `voxcpm` needs local
  models; `indextts` needs the IndexTTS-2.5 sidecar (port 8310).
- `ffmpeg` must be available to the backend for audio export.

## Install

```bash
cd cli && uv sync
uv run nf --help
```

Optionally install as a persistent tool: `uv tool install --editable cli` (exposes `nf` on PATH).

## Configuration

| Env var | Default | Description |
|---|---|---|
| `NARRAFORGE_API_URL` | `http://127.0.0.1:8002` | Backend base URL (overridden by `--api-url`) |
| `NARRAFORGE_API_TOKEN` | none | Bearer token for workers mode; unused in local mode |

## Output contract

- Human mode: tables/lines to stdout, progress and errors to stderr.
- `--json` (recommended for agents): machine-readable JSON on stdout, progress on stderr.
- Exit codes: `0` success, `1` operation error (API error, partial synthesis failure, bad input), `2` backend unreachable.

## Command reference

| Command | Description |
|---|---|
| `nf health` | Backend reachability, deploy target, engines; warns when backend storage is off |
| `nf project list` | List projects (id, name, updated_at) |
| `nf project get <id>` | Full project detail (JSON) |
| `nf project create --name N [--script FILE] [--remotion-path P]` | Create a project; attaches the narration script and stores the Remotion path |
| `nf project split <id> [--levels N] [--min-chars N] [--mode rule\|llm] [--engine E] [--preserve-audio] [--dry-run]` | Split the project narration script into chapters + segments |
| `nf project status <id>` | Per-chapter audio readiness + export configuration |
| `nf project set-engine <id> ENGINE [--param k=v ...] [--chapter CID]` | Set the TTS engine / voice params on all chapters or one |
| `nf project synthesize <id> [--chapter CID] [--segment SID] [--force] [--stop-on-error]` | Synthesize audio for all (or selected) segments sequentially |
| `nf segment list <id> [--chapter CID] [--missing-only]` | Segment-level audio status |
| `nf project export <id> [--remotion-path P] [--export-dir D] [--scaffold]` | Export chapter mp3+srt into the Remotion project (or scaffold a full Remotion project) |

Engine names: `edge_tts`, `qwen`, `mimo_tts`, `voxcpm`, `indextts`. Voice params per
engine mirror the backend's `_flatten_voice_for_synthesis` mapping; `nf` validates
keys client-side and always writes the `engine` key into the chapter voice JSON.

## Canonical workflow

```bash
nf health                                        # backend up? storage mode ok?
nf project create --name "My Video" --script narration.md
nf project split <id> --dry-run                  # preview the rebuild plan
nf project split <id>                            # rebuild chapters + segments
nf project status <id>                           # verify the split
nf project set-engine <id> edge_tts              # pick the engine
nf project synthesize <id>                       # sequential per-segment TTS
nf project export <id> --remotion-path /abs/prj  # mp3+srt into /abs/prj/public/audio
nf project status <id>                           # all_ready: true
```

Full Remotion scaffolding (audio + subtitles + segment manifest + AGENTS.md):

```bash
nf project export <id> --scaffold --remotion-path /abs/prj
```

## Behavior notes

- `split` is replace-style (backend `chapters:batch` rebuilds all chapters).
  Use `--dry-run` first; use `--preserve-audio` to keep audio of unchanged segments.
- Chapters shorter than `--min-chars` (default 80) merge with neighbors.
- User-recorded segment audio (`origin: recorded`) is locked; synthesis skips it
  unless `--force`.
- Export preflight aborts (409 `chapters_incomplete`) when any segment lacks audio.
- Segment text is capped at `MAX_SEGMENT_CHARS` (default 80) by the backend.

## Testing

```bash
cd cli
uv run pytest -q                 # unit tests (no backend needed)
uv run pytest -q -m e2e          # E2E: requires a running backend + network (uses edge_tts)
uv run ruff check .
```

The E2E suite (`tests/test_e2e_workflow.py`) exercises the full workflow against a
real backend — create/split/synthesize/export with the `edge_tts` engine — and
skips automatically when the backend is unreachable.
