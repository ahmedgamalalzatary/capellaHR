import json
import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile, Form
from app.face.detector import FaceDetector
from app.liveness.ensemble import MiniFASNetEnsemble
from app.liveness.temporal import TemporalLivenessAggregator
from app.face.recognizer import FaceRecognizer
from app.schemas.response import VerifyResponse
from app.core.config import settings

router = APIRouter()

# 1. Initialize Models
face_detector = FaceDetector()
liveness_detector = MiniFASNetEnsemble(
    v2_path=settings.liveness_v2_model_path,
    v1se_path=settings.liveness_v1se_model_path,
    threshold=settings.liveness_threshold,
)
temporal_aggregator = TemporalLivenessAggregator(
    threshold=settings.liveness_threshold,
    min_valid_frames=1,
    min_live_ratio=0.70,
)
face_recognizer = FaceRecognizer(model_path=settings.recognition_model_path)


@router.post("/verify", response_model=VerifyResponse)
async def verify(
        employee_id: str = Form(...),
        enrolled_embedding: str = Form(..., description="JSON string of the 128D float array"),
        files: list[UploadFile] = File(...),  # Now accepts multiple frames!
) -> VerifyResponse:
    # 2. Parse the embedding provided by the backend
    try:
        embedding_list = json.loads(enrolled_embedding)
        if len(embedding_list) != 128:
            raise ValueError("Embedding must be exactly 128 dimensions.")
        stored_embedding = np.array(embedding_list, dtype=np.float32)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid embedding format: {e}")

    if len(files) < 1:
        raise HTTPException(status_code=400, detail="At least 1 frame is required")

    scores = []
    best_face = None
    best_image = None
    highest_score = -1.0

    # 3. Process all frames for temporal liveness
    for file in files:
        data = await file.read()
        image_array = np.frombuffer(data, dtype=np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

        if image is None:
            continue

        faces = face_detector.detect(image)
        if len(faces) != 1:
            continue

        face = faces[0]
        bbox = (face.x, face.y, face.width, face.height)

        # Predict liveness for this frame (No flipping!)
        liveness_result = liveness_detector.predict(image=image, bbox=bbox)

        scores.append(liveness_result.score)

        # Keep track of the highest quality frame for identity matching
        if liveness_result.score > highest_score:
            highest_score = liveness_result.score
            best_face = face
            best_image = image



    # 4. Aggregate Temporal Liveness
    temporal_result = temporal_aggregator.aggregate(scores)

    # Fail immediately if spoof detected
    if not temporal_result.is_live:
        return VerifyResponse(
            success=False,
            decision="spoof",
            employee_id=employee_id,
            face_detected=True,
            face_count=1,
            liveness=False,
            liveness_score=temporal_result.score,
            reason="temporal_liveness_failed",
        )

    if best_image is None or best_face is None:
        return VerifyResponse(
            success=False,
            decision="retry",
            employee_id=employee_id,
            face_detected=False,
            face_count=0,
            reason="no_valid_face_found",
        )

    # 5. Identity Matching (Executed only if Liveness passes)
    current_embedding = face_recognizer.extract(best_image, best_face)
    is_match, similarity = face_recognizer.match(
        current_embedding, stored_embedding, settings.face_recognition_threshold
    )

    decision = "verified" if is_match else "rejected"
    reason = "success" if is_match else "identity_mismatch"

    return VerifyResponse(
        success=is_match,
        decision=decision,
        employee_id=employee_id,
        face_detected=True,
        face_count=1,
        liveness=True,
        liveness_score=temporal_result.score,
        identity_match=is_match,
        similarity=similarity,
        reason=reason,
    )