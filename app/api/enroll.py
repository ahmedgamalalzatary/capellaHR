import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile, Form
from app.face.detector import FaceDetector
from app.face.recognizer import FaceRecognizer
from app.pipeline.enrollment import EnrollmentPipeline
from app.core.config import settings
from app.schemas.response import EnrollResponse

router = APIRouter()

face_detector = FaceDetector()
face_recognizer = FaceRecognizer(model_path=settings.recognition_model_path)
pipeline = EnrollmentPipeline(
    face_detector=face_detector,
    face_recognizer=face_recognizer,
)

@router.post("/enroll", response_model=EnrollResponse)
async def enroll(
    employee_id: str = Form(...),
    file: UploadFile = File(...),
) -> EnrollResponse:
    data = await file.read()
    image_array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image file")

    result = pipeline.enroll(image)

    if result.decision != "enrolled":
        return EnrollResponse(
            success=False,
            employee_id=employee_id,
            decision=result.decision,
            reason=result.reason,
        )

    # Return the embedding directly to the backend
    return EnrollResponse(
        success=True,
        employee_id=employee_id,
        decision=result.decision,
        embedding=result.embedding,
        embedding_dimensions=len(result.embedding) if result.embedding else 0,
        message="Face processed. Store this embedding in your database.",
    )