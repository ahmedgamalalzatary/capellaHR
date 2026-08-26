import cv2
import numpy as np

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.face.detector import FaceDetector


router = APIRouter()

face_detector = FaceDetector()


@router.post("/detect")
async def detect(file: UploadFile = File(...)):
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

    faces = face_detector.detect(image)

    return {
        "success": True,
        "face_count": len(faces),
        "faces": [
            {
                "x": face.x,
                "y": face.y,
                "width": face.width,
                "height": face.height,
                "confidence": face.confidence,
            }
            for face in faces
        ],
    }