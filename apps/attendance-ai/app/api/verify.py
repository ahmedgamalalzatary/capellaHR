import json

import cv2
import numpy as np

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    UploadFile,
)

from app.core.config import settings
from app.face.detector import FaceDetector
from app.face.recognizer import FaceRecognizer
from app.liveness.ensemble import MiniFASNetEnsemble
from app.liveness.temporal import TemporalLivenessAggregator
from app.schemas.response import VerifyResponse


router = APIRouter()


# ============================================================
# Models
# ============================================================

face_detector = FaceDetector()

liveness_detector = MiniFASNetEnsemble(
    v2_path=settings.liveness_v2_model_path,
    v1se_path=settings.liveness_v1se_model_path,
    threshold=settings.liveness_threshold,
)

temporal_aggregator = TemporalLivenessAggregator(
    threshold=settings.liveness_threshold,

    # IMPORTANT:
    # Require at least 3 valid frames.
    min_valid_frames=3,

    # At least 70% of valid frames must be live.
    min_live_ratio=0.70,
)

face_recognizer = FaceRecognizer(
    model_path=settings.recognition_model_path
)


# ============================================================
# Verify
# ============================================================

@router.post(
    "/verify",
    response_model=VerifyResponse,
)
async def verify(
    employee_id: str = Form(...),

    enrolled_embedding: str = Form(
        ...,
        description="JSON string of the 128D float array",
    ),

    files: list[UploadFile] = File(...),
) -> VerifyResponse:

    # ========================================================
    # 1. Parse stored embedding
    # ========================================================

    try:

        embedding_list = json.loads(
            enrolled_embedding
        )

        if len(embedding_list) != 128:
            raise ValueError(
                "Embedding must be exactly 128 dimensions."
            )

        stored_embedding = np.array(
            embedding_list,
            dtype=np.float32,
        )

    except Exception as error:

        raise HTTPException(
            status_code=400,
            detail=f"Invalid embedding format: {error}",
        )


    # ========================================================
    # 2. Basic frame validation
    # ========================================================

    received_frames = len(files)

    if received_frames < 5:

        raise HTTPException(
            status_code=400,
            detail=(
                f"At least 5 frames are required. "
                f"Received {received_frames}."
            ),
        )


    # ========================================================
    # 3. Tracking
    # ========================================================

    scores: list[float] = []

    frame_results = []

    processed_frames = 0
    invalid_image_frames = 0
    no_face_frames = 0
    multiple_face_frames = 0


    best_face = None
    best_image = None
    highest_score = -1.0


    # ========================================================
    # 4. Process EVERY frame
    # ========================================================

    for frame_index, file in enumerate(
        files,
        start=1,
    ):

        data = await file.read()

        image_array = np.frombuffer(
            data,
            dtype=np.uint8,
        )

        image = cv2.imdecode(
            image_array,
            cv2.IMREAD_COLOR,
        )


        # ----------------------------------------------------
        # Invalid image
        # ----------------------------------------------------

        if image is None:

            invalid_image_frames += 1

            frame_results.append(
                {
                    "frame": frame_index,
                    "status": "invalid_image",
                }
            )

            continue


        # ----------------------------------------------------
        # Face detection
        # ----------------------------------------------------

        faces = face_detector.detect(
            image
        )


        # No face
        if len(faces) == 0:

            no_face_frames += 1

            frame_results.append(
                {
                    "frame": frame_index,
                    "status": "no_face",
                }
            )

            continue


        # Multiple faces
        if len(faces) > 1:

            multiple_face_frames += 1

            frame_results.append(
                {
                    "frame": frame_index,
                    "status": "multiple_faces",
                    "face_count": len(faces),
                }
            )

            continue


        # ----------------------------------------------------
        # Exactly one face
        # ----------------------------------------------------

        face = faces[0]

        bbox = (
            face.x,
            face.y,
            face.width,
            face.height,
        )


        # ----------------------------------------------------
        # Liveness
        # ----------------------------------------------------

        liveness_result = (
            liveness_detector.predict(
                image=image,
                bbox=bbox,
            )
        )


        scores.append(
            liveness_result.score
        )

        processed_frames += 1


        frame_results.append(
            {
                "frame": frame_index,

                "status": "processed",

                "face_confidence": (
                    face.confidence
                ),

                "label": (
                    liveness_result.label
                ),

                "live_score": (
                    liveness_result.score
                ),

                "probabilities": (
                    liveness_result.probabilities
                ),
            }
        )


        # ----------------------------------------------------
        # Keep best frame for recognition
        # ----------------------------------------------------

        if (
            liveness_result.score
            > highest_score
        ):

            highest_score = (
                liveness_result.score
            )

            best_face = face
            best_image = image


    # ========================================================
    # 5. Temporal liveness
    # ========================================================

    temporal_result = (
        temporal_aggregator.aggregate(
            scores
        )
    )


    # ========================================================
    # 6. Liveness failed
    # ========================================================

    if not temporal_result.is_live:

        return VerifyResponse(
            success=False,

            decision="spoof",

            employee_id=employee_id,

            face_detected=(
                processed_frames > 0
            ),

            face_count=1,

            liveness=False,

            liveness_score=(
                temporal_result.score
            ),

            identity_match=None,

            similarity=None,

            reason="temporal_liveness_failed",

            # Additional diagnostics
            received_frames=received_frames,

            processed_frames=processed_frames,

            invalid_image_frames=(
                invalid_image_frames
            ),

            no_face_frames=no_face_frames,

            multiple_face_frames=(
                multiple_face_frames
            ),

            live_frames=(
                temporal_result.live_frames
            ),

            spoof_frames=(
                temporal_result.spoof_frames
            ),

            frame_results=frame_results,
        )


    # ========================================================
    # 7. No usable frame
    # ========================================================

    if (
        best_image is None
        or best_face is None
    ):

        return VerifyResponse(
            success=False,

            decision="retry",

            employee_id=employee_id,

            face_detected=False,

            face_count=0,

            liveness=False,

            liveness_score=(
                temporal_result.score
            ),

            identity_match=None,

            similarity=None,

            reason="no_valid_face_found",

            received_frames=received_frames,

            processed_frames=processed_frames,

            invalid_image_frames=(
                invalid_image_frames
            ),

            no_face_frames=no_face_frames,

            multiple_face_frames=(
                multiple_face_frames
            ),

            live_frames=(
                temporal_result.live_frames
            ),

            spoof_frames=(
                temporal_result.spoof_frames
            ),

            frame_results=frame_results,
        )


    # ========================================================
    # 8. Face recognition
    # ========================================================

    current_embedding = (
        face_recognizer.extract(
            best_image,
            best_face,
        )
    )


    is_match, similarity = (
        face_recognizer.match(
            current_embedding,
            stored_embedding,
            settings.face_recognition_threshold,
        )
    )


    # ========================================================
    # 9. Final decision
    # ========================================================

    decision = (
        "verified"
        if is_match
        else "rejected"
    )

    reason = (
        "success"
        if is_match
        else "identity_mismatch"
    )


    return VerifyResponse(

        success=is_match,

        decision=decision,

        employee_id=employee_id,

        face_detected=True,

        face_count=1,

        liveness=True,

        liveness_score=(
            temporal_result.score
        ),

        identity_match=is_match,

        similarity=similarity,

        reason=reason,

        received_frames=received_frames,

        processed_frames=processed_frames,

        invalid_image_frames=(
            invalid_image_frames
        ),

        no_face_frames=no_face_frames,

        multiple_face_frames=(
            multiple_face_frames
        ),

        live_frames=(
            temporal_result.live_frames
        ),

        spoof_frames=(
            temporal_result.spoof_frames
        ),

        frame_results=frame_results,
    )