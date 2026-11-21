---
name: narraforge
version: 0.1.0
description: Drive the NarraForge backend via the `nf` CLI to turn a narration markdown script into per-chapter audio + subtitles for a Remotion project. Use when the user asks to create a NarraForge project, paste a narration script, split it into segments, synthesize TTS audio, or export audio into a Remotion project's public/audio directory.
---

# NarraForge narration pipeline via the nf CLI

> Skill version tracks the `nf` CLI it drives (keep in sync with `cli/pyproject.toml`;
> currently 0.1.0).

## Prerequisites

- **The backend must be running** — the CLI is a pure HTTP client, every command hits it.
  The frontend (5173) and the LangGraph agent (2024) are NOT required.
- Check with `nf health --json` (exit code 2 = not reachable). If it is not running,
  start it yourself in the background, then wait for health before continuing:

  ```bash
  cd backend && nohup uv run uvicorn main:app --host 127.0.0.1 --port 8002 > /tmp/narraforge-backend.log 2>&1 &
  # poll until `nf health --json` reports healthy (usually a few seconds)
  ```

  Do NOT start a second instance if one is already healthy (port bind would fail).
- Audio persistence requires backend storage mode; `nf health` warns when `features.backend_storage` is false.
- Workers mode needs `NARRAFORGE_API_TOKEN`; local mode needs no auth.
- Engine availability: `edge_tts` needs only internet access (no API keys / GPU —
  the default choice for testing); `mimo_tts` / `qwen` need API keys configured;
  `voxcpm` needs local models; `indextts` needs the IndexTTS sidecar on port 8310.
  `ffmpeg` is required for export.
- When driving programmatically, pass `--json` on every command and parse stdout JSON.
  Progress/status lines go to stderr; exit codes: 0 ok, 1 operation error, 2 backend unreachable.

## Canonical workflow

1. Create the project with the narration script attached:

   ```bash
   nf project create --name "<project name>" --script narration.md
   ```

2. Split into chapters and segments (preview first):

   ```bash
   nf project split <id> --dry-run     # reuse report, nothing written
   nf project split <id>               # markdown heading level auto-detected
   ```

   - Override the heading level with `--levels 2`; LLM semantic split with `--mode llm`.
   - Chapters shorter than `--min-chars` (default 80) are merged with their neighbors —
     pass `--min-chars 0` to keep tiny chapters, or write longer chapters.
   - Re-splitting after edits: add `--preserve-audio` to reuse audio of unchanged segments.
   - Segment text is capped at `MAX_SEGMENT_CHARS` (default 80) — the backend merges/truncates automatically.

3. Inspect the result:

   ```bash
   nf project status <id>            # per-chapter ready/total + export config
   nf segment list <id> --missing-only
   ```

4. Choose the engine (repeatable `--param key=value`):

   ```bash
   nf project set-engine <id> mimo_tts --param mode=preset --param voice_id=<preset-id>
   nf project set-engine <id> edge_tts --param voice=zh-CN-YunxiNeural
   nf project set-engine <id> voxcpm --param mode=clone --param voice_id=<role-id>
   ```

5. Synthesize (sequential, skip recorded/empty unless `--force`):

   ```bash
   nf project synthesize <id>
   ```

   Exit code 1 on failures; the JSON `results` array lists each failed segment with its error.

6. Export into the Remotion project (default export dir `{remotion_path}/public/audio`):

   ```bash
   nf project export <id> --remotion-path /abs/path/to/remotion-prj
   ```

   Full Remotion scaffold alternative (audio + subtitles + segment manifest + AGENTS.md):

   ```bash
   nf project export <id> --scaffold   # add --remotion-path to set the target dir
   ```

7. Verify: `nf project status <id>` reports `all_ready: true`.

## Pitfalls

- `nf project split` is replace-style (backend `chapters:batch` re-creates all chapters). Use `--dry-run` first and `--preserve-audio` when re-splitting.
- User-recorded segment audio is locked; synthesis skips it unless `--force`.
- Export aborts with 409 `chapters_incomplete` when any segment lacks audio — run `nf project status` first. The export directory itself may exist after an abort (created during path resolution), but no media files are written.
- PATCH project `configs` replaces the whole bucket; `nf project export` merges `export_directory` for you.
- Use absolute paths for `--remotion-path`; export dirs may be relative to it (default `public/audio`).
- When testing, prefer the `edge_tts` engine (no API keys, no local GPU).
