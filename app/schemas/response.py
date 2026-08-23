from typing import Optional

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    version: str


class VerifyResponse(BaseModel):
    success: bool
    decision: str

    employee_id: str

    face_detected: bool
    face_count: int

    liveness: Optional[bool] = None
    liveness_score: Optional[float] = None

    identity_match: Optional[bool] = None
    similarity: Optional[float] = None

    reason: Optional[str] = None

class EnrollResponse(BaseModel):
    success: bool
    employee_id: str
    decision: str
    reason: Optional[str] = None
    embedding: Optional[list[float]] = None  # <-- Added this line
    embedding_dimensions: Optional[int] = None
    message: Optional[str] = None