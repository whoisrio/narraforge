"""HTTP client for the NarraForge backend (thin, JSON in / JSON out)."""
from __future__ import annotations

import httpx

from .config import Config
from .errors import ApiError, BackendUnavailableError

REQUEST_TIMEOUT = 300.0  # per-segment synthesis can be slow


def _parse_detail(detail: object) -> tuple[str, str]:
    """Backend error details are either a plain string or an A8 envelope {code, message}."""
    if isinstance(detail, dict):
        code = str(detail.get("code") or detail.get("message") or "error")
        message = str(detail.get("message") or code)
        return code, message
    text = str(detail) if detail is not None else "error"
    return text or "error", text or "error"


class Client:
    """Sync httpx client with one method per backend endpoint."""

    def __init__(self, config: Config, transport: httpx.BaseTransport | None = None) -> None:
        headers = {"Accept": "application/json"}
        if config.token:
            headers["Authorization"] = f"Bearer {config.token}"
        self._client = httpx.Client(
            base_url=config.api_url,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    # -- core ---------------------------------------------------------------

    def request(self, method: str, path: str, **kwargs: object) -> dict | list:
        try:
            resp = self._client.request(method, path, **kwargs)  # type: ignore[arg-type]
        except httpx.TransportError as exc:
            raise BackendUnavailableError(
                f"cannot reach NarraForge backend at {self._client.base_url}: {exc}\n"
                "start it with: cd backend && uv run uvicorn main:app "
                "--host 127.0.0.1 --port 8002 --reload"
            ) from exc
        if resp.status_code >= 400:
            detail = None
            try:
                payload = resp.json()
                if isinstance(payload, dict):
                    detail = payload.get("detail")
            except ValueError:
                detail = None
            code, message = _parse_detail(detail)
            raise ApiError(resp.status_code, code, message)
        return resp.json()  # type: ignore[no-any-return]

    # -- system -------------------------------------------------------------

    def health(self) -> dict:
        return self.request("GET", "/health")  # type: ignore[return-value]

    def capabilities(self) -> dict:
        return self.request("GET", "/api/config/capabilities")  # type: ignore[return-value]

    # -- projects -----------------------------------------------------------

    def list_projects(self) -> list[dict]:
        data = self.request("GET", "/api/segmented-projects")
        items = data.get("items", []) if isinstance(data, dict) else []
        return list(items)

    def get_project(self, project_id: str) -> dict:
        return self.request("GET", f"/api/segmented-projects/{project_id}")  # type: ignore[return-value]

    def create_project(self, project: dict) -> dict:
        return self.request("POST", "/api/segmented-projects", json=project)  # type: ignore[return-value]

    def patch_project(self, project_id: str, patch: dict) -> dict:
        return self.request("PATCH", f"/api/segmented-projects/{project_id}", json=patch)  # type: ignore[return-value]

    def put_narration_script(self, project_id: str, text: str) -> dict:
        return self.request(
            "PUT",
            f"/api/segmented-projects/{project_id}/narration-script",
            json={"text": text},
        )  # type: ignore[return-value]

    def patch_chapter(self, project_id: str, chapter_id: str, patch: dict) -> dict:
        return self.request(
            "PATCH",
            f"/api/segmented-projects/{project_id}/chapters/{chapter_id}",
            json=patch,
        )  # type: ignore[return-value]

    def chapters_batch(self, project_id: str, payload: dict) -> dict:
        return self.request(
            "POST",
            f"/api/segmented-projects/{project_id}/chapters:batch",
            json=payload,
        )  # type: ignore[return-value]

    # -- text split ---------------------------------------------------------

    def markdown_detect(self, text: str, min_chars: int) -> dict:
        return self.request(
            "POST",
            "/api/text-split/markdown-detect",
            json={"text": text, "min_chars": min_chars, "front_matter_mode": "skip"},
        )  # type: ignore[return-value]

    def markdown_split(self, text: str, levels: list[int], min_chars: int) -> dict:
        return self.request(
            "POST",
            "/api/text-split/markdown-split",
            json={
                "text": text,
                "levels": levels,
                "min_chars": min_chars,
                "front_matter_mode": "skip",
            },
        )  # type: ignore[return-value]

    def llm_split(self, text: str) -> dict:
        return self.request("POST", "/api/text-split/llm", json={"text": text})  # type: ignore[return-value]

    # -- synthesis / export -------------------------------------------------

    def synthesize_segment(
        self, project_id: str, chapter_id: str, segment_id: str, *, force: bool = False
    ) -> dict:
        return self.request(
            "POST",
            f"/api/segmented-projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}/synthesize",
            json={"force": force},
        )  # type: ignore[return-value]

    def export_all_chapters(self, project_id: str) -> dict:
        return self.request(
            "POST", f"/api/segmented-projects/{project_id}/export-all-chapters"
        )  # type: ignore[return-value]

    def scaffold_remotion(self, project_id: str, target_dir: str | None = None) -> dict:
        return self.request(
            "POST",
            f"/api/segmented-projects/{project_id}/scaffold-remotion",
            json={"target_dir": target_dir},
        )  # type: ignore[return-value]
