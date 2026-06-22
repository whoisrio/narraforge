"""Time helpers shared by ORM models and services."""
from datetime import UTC, datetime
def utcnow() -> datetime:
    """Return naive UTC datetime without using deprecated utcnow().

    Existing SQLite DateTime columns in this project store naive UTC values.
    Keeping the value naive avoids mixing aware and naive datetimes while
    remaining compatible with Python 3.13+ deprecation guidance.
    """
    return datetime.now(UTC).replace(tzinfo=None)
