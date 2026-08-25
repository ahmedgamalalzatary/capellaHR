import cv2
import numpy as np

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core.config import settings
from app.face.detector import FaceDetector
from app.liveness.ensemble import MiniFASNetEnsemble
from app.liveness.temporal import TemporalLivenessAggregator


router = APIRouter()

face_detector = FaceDetector()

liveness_detector = MiniFASNetEnsemble(
    v2_path=settings.liveness_v2_model_path,
    v1se_path=settings.liveness_v1se_model_path,
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
    if len(files) < 5:
        raise HTTPException(
            status_code=400,
            detail="At least 5 frames are required",
        )

    scores: list[float] = []
    labels: list[str] = []
    frame_results = []

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

        bbox = (
            face.x,
            face.y,
            face.width,
            face.height,
        )

        result = liveness_detector.predict(
            image=image,
            bbox=bbox,
        )


        scores.append(result.score)
        labels.append(result.label)

        frame_results.append(
            {
                "frame": processed_frames + 1,
                "label": result.label,
                "live_score": result.score,
                "probabilities": result.probabilities,
            }
        )

        processed_frames += 1

    if len(scores) < 1:
        return {
            "success": False,
            "decision": "retry",
            "reason": "insufficient_valid_frames",
            "valid_frames": len(scores),
            "required_frames": 1,
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
        "frames": frame_results,

    }