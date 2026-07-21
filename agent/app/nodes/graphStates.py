from typing import TypedDict,Literal
from pydantic import BaseModel,Field


class ReviewOpinions(BaseModel):
    aspect: str
    option: str

class ReviewResult(BaseModel):
    result: bool
    opinions: list[ReviewOpinions]


class GraphState(BaseModel):
    source: str=Field(description="original text")
    narration: str
    reviewResult: ReviewResult
