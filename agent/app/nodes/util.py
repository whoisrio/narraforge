"""Node helpers shared across workflow graphs."""
from __future__ import annotations

from typing import Any


def with_usage(node_id: str, usage: dict | None, update: dict[str, Any]) -> dict[str, Any]:
    """Attach the node's LLM token usage to its state update.

    Merged into ``state["stage_usage"]`` via the ``operator.ior`` reducer
    (see ``app.state.StageUsage``), so per-stage token consumption persists
    in checkpoints and the UI can read it when re-attaching to a finished
    thread -- custom-channel milestone events are not replayable state.
    """
    if usage:
        update["stage_usage"] = {node_id: usage}
    return update
