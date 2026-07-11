"""WorkflowRun — tracks execution state of a narration workflow."""
from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time_utils import utcnow


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"

    id = Column(String, primary_key=True)
    project_id = Column(
        String,
        ForeignKey("segmented_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    thread_id = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False, default="running")
    current_stage = Column(String, nullable=False)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    project = relationship("SegmentedProject", back_populates="workflow_runs")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<WorkflowRun(id={self.id}, status={self.status!r})>"
