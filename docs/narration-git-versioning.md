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

Names in the file tree are derived **at write time** from content — database
primary keys are never used for naming and never need to change:

- **project-slug** — lowercased pinyin/ASCII of the project name, max 40 chars; collisions within one snapshot run get `-{4-char blake2s hex of DB id}`.
- **chapter-id** — `ch{NN}-{title-slug}` from (position+1, design_title/name); `ch{NN}` when title is empty.
- **segment-id** — `s{NNN}` assigned by position order (1-based) at write time. Note: numbers follow the current ordering, so inserting/removing segments renumbers later ones (frozen IDs would need a persisted mapping and are deliberately out of scope).

The real DB ids are still recorded inside `project.yaml` / `chapter.yaml`
for traceability. On each snapshot, project dirs belonging to projects in
the current database but written under an outdated name (legacy DB-id dirs,
pre-rename slugs) are swept; dirs of other databases sharing the repo are
left untouched. To isolate environments, give each its own
`NARRATION_REPO_PATH` (the e2e overlay `.env.e2e` uses
`./data/narration-repo-e2e`).

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

### Inspect history

```bash
cd backend/data/narration-repo
git log --oneline
git log -- projects/deepseek-ce-lve
git show HEAD -- projects/deepseek-ce-lve/chapters/ch01-kai-chang-bai/script.md
```

## Push to remote

The daily snapshot can also push to a configured remote. The remote URL is a
**global setting** (DB key `narration_git_remote`), editable from `/settings`
(see `GET/PUT /api/config/narration-git-remote`).

- Remote unset (empty) -> local commit only, no push.
- Remote set -> after commit, `git push origin main` (regular push, **no force**).
- A manual `POST /api/config/narration-git/snapshot` (or the `/settings`「立即提交并推送」
  button) runs the same snapshot + push on demand.

Auth: embed credentials in the URL (`https://user:token@host/repo.git`) or rely on
an SSH key. Multi-environment pushes to the same remote diverge histories and
will be rejected on non-fast-forward (use separate branches/remotes per env).

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
