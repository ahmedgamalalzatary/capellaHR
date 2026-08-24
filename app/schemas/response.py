from typing import Any, Optional

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

    # Diagnostics
    received_frames: int = 0
    processed_frames: int = 0

    invalid_image_frames: int = 0
    no_face_frames: int = 0
    multiple_face_frames: int = 0

    live_frames: int = 0
    spoof_frames: int = 0

    frame_results: list[dict[str, Any]] = []

class EnrollResponse(BaseModel):
    success: bool
    employee_id: str
    decision: str
    reason: Optional[str] = None
    embedding: Optional[list[float]] = None  # <-- Added this line
    embedding_dimensions: Optional[int] = None
    message: Optional[str] = None