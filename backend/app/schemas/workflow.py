"""Pydantic schemas for Workflow API request/response validation."""

from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime


class WorkflowStageOut(BaseModel):
    """Output schema for a single workflow stage."""

    name: str
    status: str
    duration_sec: Optional[float] = None


class WorkflowRunOut(BaseModel):
    """Output schema for a workflow run."""

    id: str
    project_id: str
    thread_id: str
    status: str
    current_stage: str
    stages: list[WorkflowStageOut] = Field(default_factory=list)
    interrupt_payload: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class WorkflowStartRequest(BaseModel):
    """Request schema for starting a new workflow run."""

    source_document: Optional[str] = None


class WorkflowResumeRequest(BaseModel):
    """Request schema for resuming an interrupted workflow run."""

    stage: str
    action: str  # "approve" | "reject"
    edited_script: Optional[str] = None
    comment: Optional[str] = None
    feedback: Optional[str] = None


class WorkflowReplayRequest(BaseModel):
    """Request schema for replaying a workflow from a specific stage."""

    from_stage: str


class WorkflowForkRequest(BaseModel):
    """Request schema for forking a workflow run with optional state override."""

    from_stage: str
    state_override: dict[str, Any] = Field(default_factory=dict)
