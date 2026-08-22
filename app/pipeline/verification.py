from dataclasses import dataclass

import numpy as np

from app.face.detector import FaceDetector
from app.liveness.detector import LivenessDetector


@dataclass
class VerificationResult:
    face_detected: bool
    face_count: int

    liveness: bool
    liveness_score: float

    decision: str
    reason: str


class VerificationPipeline:
    def __init__(
        self,
        face_detector: FaceDetector,
        liveness_detector: LivenessDetector,
    ) -> None:
        self.face_detector = face_detector
        self.liveness_detector = liveness_detector

    def verify(self, image: np.ndarray) -> VerificationResult:
        faces = self.face_detector.detect(image)

        face_count = len(faces)

        if face_count == 0:
            return VerificationResult(
                face_detected=False,
                face_count=0,
                liveness=False,
                liveness_score=0.0,
                decision="rejected",
                reason="no_face_detected",
            )

        if face_count > 1:
            return VerificationResult(
                face_detected=True,
                face_count=face_count,
                liveness=False,
                liveness_score=0.0,
                decision="rejected",
                reason="multiple_faces_detected",
            )

        face = faces[0]

        liveness_result = self.liveness_detector.predict(
            image=image,
            x=face.x,
            y=face.y,
            width=face.width,
            height=face.height,
        )

        if not liveness_result.is_live:
            return VerificationResult(
                face_detected=True,
                face_count=1,
                liveness=False,
                liveness_score=liveness_result.score,
                decision="rejected",
                reason=liveness_result.label,
            )

        return VerificationResult(
            face_detected=True,
            face_count=1,
            liveness=True,
            liveness_score=liveness_result.score,
            decision="pending_identity",
            reason="live_face_detected",
        )