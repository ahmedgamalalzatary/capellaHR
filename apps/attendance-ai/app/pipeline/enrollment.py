from dataclasses import dataclass
from typing import Optional
import numpy as np
from app.face.detector import FaceDetector
from app.face.recognizer import FaceRecognizer

@dataclass
class EnrollmentResult:
    face_detected: bool
    face_count: int
    embedding: Optional[list[float]]
    decision: str
    reason: str

class EnrollmentPipeline:
    def __init__(
        self,
        face_detector: FaceDetector,
        face_recognizer: FaceRecognizer,
    ) -> None:
        self.face_detector = face_detector
        self.face_recognizer = face_recognizer

    def enroll(self, image: np.ndarray) -> EnrollmentResult:
        faces = self.face_detector.detect(image)
        face_count = len(faces)

        if face_count == 0:
            return EnrollmentResult(
                face_detected=False,
                face_count=0,
                embedding=None,
                decision="rejected",
                reason="no_face_detected",
            )

        if face_count > 1:
            return EnrollmentResult(
                face_detected=True,
                face_count=face_count,
                embedding=None,
                decision="rejected",
                reason="multiple_faces_detected",
            )

        face = faces[0]
        embedding = self.face_recognizer.extract(image, face)

        return EnrollmentResult(
            face_detected=True,
            face_count=1,
            embedding=embedding.tolist(),
            decision="enrolled",
            reason="success",
        )