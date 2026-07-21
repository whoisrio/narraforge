# Narration Git Versioning

Automatic, one-way persistence of narration text into a git repo so history is queryable via standard `git log`. No app-DB version tables; no manual triggers.

## Layout

```
backend/data/narration-repo/
├── .git/
├── .gitignore
└── projects/{project-slug}/
    ├── project.yaml
    ├── source.md
    └── chapters/{chapter-id}/
        ├── chapter.yaml
        ├── original.md
        ├── script.md
        └── segments.md
```

Path is overridable via `NARRATION_REPO_PATH`.

## Semantic IDs

- **project-slug** — lowercased pinyin/ASCII, max 40 chars, collisions get `-{4-char blake2s hex}`.
- **chapter-id** — `ch{NN}-{title-slug}` from (position, design_title/name); `ch{NN}` when title is empty.
- **segment-id** — `s{NNN}`, frozen at first split; deleted IDs never reused.

Segments are stored as one HTML-comment header + text block per row:

```
<!-- s001 kind=narration -->
第一段文本。

<!-- s002 kind=dialogue role=role_xm emotion=happy -->
"你好！"
```

The header omits `voice=...` when it equals the default `{"source":"chapter"}`; otherwise a compact JSON is emitted.

## Schedule

Cron-triggered via APScheduler `BackgroundScheduler`, in-process. Default: **03:00 local time daily**.

Override with:

- `NARRATION_SNAPSHOT_ENABLED` — `1` (default) / `0`
- `NARRATION_SNAPSHOT_CRON` — standard 5-field crontab (default `0 3 * * *`)
- `NARRATION_GIT_AUTHOR_NAME` / `NARRATION_GIT_AUTHOR_EMAIL`

Each run: read every SegmentedProject → serialize into the repo → `git add -A` → single commit if anything changed.

## Commit format

```
snapshot: N project(s) (YYYY-MM-DD HH:MM:SS UTC)

Projects:
- {project-id}: N chapter(s), M segment(s)
- ...
```

## Manual operations

### Trigger a snapshot now

```bash
cd backend
uv run python -c "from app.services.narration_versioning.job import snapshot_all; print(snapshot_all())"
```

### Migrate legacy IDs to semantic form

```bash
cd backend
uv run python -m scripts.migrate_narration_ids --dry-run   # preview
uv run python -m scripts.migrate_narration_ids             # apply
```

Idempotent; safe to re-run.

### Inspect history

```bash
cd backend/data/narration-repo
git log --oneline
git log -- projects/deepseek-ce-lve
git show HEAD -- projects/deepseek-ce-lve/chapters/ch01-kai-chang-bai/script.md
```

## Design boundaries

- **One-way.** The repo is derived state; the app-DB is the source of truth. Never edit files in the repo expecting them to sync back.
- **No audio.** `projects/*/audio/` is `.gitignore`d; audio lives under `backend/uploads/`.
- **Session-scoped agent runs.** Agent workflow state (LangGraph checkpoints) is not covered here — only the DB text layers.

## Post-MVP (deliberately out of scope)

- Reverse import (`git checkout` → DB).
- Diff / restore API endpoints.
- Frontend history UI.
- Tag-based release milestones.
- Audio file versioning.
