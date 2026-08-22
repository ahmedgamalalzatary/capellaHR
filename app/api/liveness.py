import cv2
import numpy as np

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core.config import settings
from app.face.detector import FaceDetector
from app.liveness.detector import LivenessDetector
from app.liveness.temporal import TemporalLivenessAggregator


router = APIRouter()

face_detector = FaceDetector()

liveness_detector = LivenessDetector(
    model_path=settings.liveness_model_path,
    threshold=settings.liveness_threshold,
)

temporal_aggregator = TemporalLivenessAggregator(
    threshold=settings.liveness_threshold,
    min_valid_frames=3,
    min_live_ratio=0.70,
)


@router.post("/liveness")
async def check_liveness(
    files: list[UploadFile] = File(...),
):
    if len(files) < 3:
        raise HTTPException(
            status_code=400,
            detail="At least 5 frames are required",
        )

    scores: list[float] = []
    labels: list[str] = []

    processed_frames = 0
    rejected_frames = 0

    for file in files:

        data = await file.read()

        image_array = np.frombuffer(
            data,
            dtype=np.uint8,
        )

        image = cv2.imdecode(
            image_array,
            cv2.IMREAD_COLOR,
        )

        if image is None:
            rejected_frames += 1
            continue

        faces = face_detector.detect(image)

        # No face in this frame
        if len(faces) == 0:
            rejected_frames += 1
            continue

        # More than one face
        if len(faces) > 1:
            return {
                "success": False,
                "decision": "rejected",
                "reason": "multiple_faces_detected",
            }

        face = faces[0]

        result = liveness_detector.predict(
            image=image,
            x=face.x,
            y=face.y,
            width=face.width,
            height=face.height,
        )

        scores.append(result.score)
        labels.append(result.label)

        processed_frames += 1

    if len(scores) < 3:
        return {
            "success": False,
            "decision": "retry",
            "reason": "insufficient_valid_frames",
            "valid_frames": len(scores),
            "required_frames": 5,
            "rejected_frames": rejected_frames,
        }

    temporal_result = temporal_aggregator.aggregate(
        scores
    )

    # If any replay/print prediction dominates,
    # expose it in the response for diagnostics.
    replay_count = labels.count("replay_attack")
    print_count = labels.count("print_attack")

    if temporal_result.is_live:

        decision = "live"

    else:

        decision = "spoof"

    return {
        "success": True,
        "decision": decision,

        "liveness_score": temporal_result.score,

        "total_frames": temporal_result.total_frames,
        "valid_frames": temporal_result.valid_frames,

        "live_frames": temporal_result.live_frames,
        "spoof_frames": temporal_result.spoof_frames,

        "live_ratio": (
            temporal_result.live_frames
            / temporal_result.valid_frames
        ),

        "print_attack_frames": print_count,
        "replay_attack_frames": replay_count,

        "rejected_frames": rejected_frames,
    }