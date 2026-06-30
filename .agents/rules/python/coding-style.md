---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Python Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Python specific content.

## Standards

- Follow **PEP 8** conventions
- Use **type annotations** on all function signatures

## Immutability

Prefer immutable data structures:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class User:
    name: str
    email: str

from typing import NamedTuple

class Point(NamedTuple):
    x: float
    y: float
```

## Formatting

- **black** for code formatting
- **isort** for import sorting
- **ruff** for linting

## Reference

See skill: `python-patterns` for comprehensive Python idioms and patterns.

### SQLAlchemy JSON Columns (added 2026-06-30)

- Engine-specific parameters belong in a single `voice` or `engine` JSON column, not flattened as individual columns.
- Default values for JSON columns use `default=lambda: {"key": "value"}` (not `default=dict` for mutable defaults).
- When reading JSON columns, always handle missing keys gracefully: `voice.get("engine", "edge_tts")`.
- Derive properties via `@property` if they can be computed from other columns (e.g. `project_id` on Segment from `chapter.project_id`).
