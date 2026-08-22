import cv2
import numpy as np

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.face.detector import FaceDetector
from app.liveness.detector import LivenessDetector
from app.pipeline.verification import VerificationPipeline
from app.schemas.response import VerifyResponse
from app.core.config import settings


router = APIRouter()


face_detector = FaceDetector()

liveness_detector = LivenessDetector(
    model_path=settings.liveness_model_path,
    threshold=settings.liveness_threshold,
)

pipeline = VerificationPipeline(
    face_detector=face_detector,
    liveness_detector=liveness_detector,
)


@router.post("/verify", response_model=VerifyResponse)
async def verify(
    employee_id: str,
    file: UploadFile = File(...),
) -> VerifyResponse:

    data = await file.read()

    image_array = np.frombuffer(data, dtype=np.uint8)

    image = cv2.imdecode(
        image_array,
        cv2.IMREAD_COLOR,
    )

    if image is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid image",
        )

    result = pipeline.verify(image)

    return VerifyResponse(
        success=result.decision == "pending_identity",
        decision=result.decision,
        employee_id=employee_id,
        face_detected=result.face_detected,
        face_count=result.face_count,
        liveness=result.liveness,
        liveness_score=result.liveness_score,
        identity_match=None,
        similarity=None,
        reason=result.reason,
    )