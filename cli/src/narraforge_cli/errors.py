"""CLI error types and their exit-code mapping."""
from __future__ import annotations


class NarraForgeCliError(Exception):
    """Base class for all CLI errors."""

    exit_code = 1


class BackendUnavailableError(NarraForgeCliError):
    """The backend HTTP endpoint could not be reached."""

    exit_code = 2


class ApiError(NarraForgeCliError):
    """The backend returned a non-2xx response."""

    exit_code = 1

    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(f"[{status_code}] {code}: {message}")
