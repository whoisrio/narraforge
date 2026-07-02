from sqlalchemy import Column, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base
from app.core.time_utils import utcnow


class VoiceProfile(Base):
    __tablename__ = "voice_profiles"

    def __repr__(self):
        return f"<VoiceProfile(id={self.id}, name={self.name})>"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)

    description = Column(String, nullable=True)
    avatar = Column(String, nullable=True)

    project_id = Column(String, ForeignKey("segmented_projects.id", ondelete="SET NULL"), nullable=True)

    voice = Column(JSON, nullable=False, default=dict)
    voice_params = Column(JSON, nullable=False, default=dict)
    preview = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=utcnow)
