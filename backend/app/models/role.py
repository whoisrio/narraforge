from __future__ import annotations

from sqlalchemy import Column, DateTime, JSON, String

from app.core.database import Base
from app.core.time_utils import utcnow


class Role(Base):
    __tablename__ = "roles"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    avatar = Column(String, nullable=True)
    description = Column(String, nullable=True)
    role_kind = Column(String, nullable=False, default="cast")
    voice = Column(JSON, nullable=False, default=lambda: {"engine": "edge_tts", "params": {}})
    favorite_styles = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Role(id={self.id}, name={self.name!r})>"
