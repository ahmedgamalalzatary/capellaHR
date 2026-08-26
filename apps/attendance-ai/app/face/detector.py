from dataclasses import dataclass

import cv2
import numpy as np

from app.core.config import settings


@dataclass
class FaceDetection:
    x: int
    y: int
    width: int
    height: int
    confidence: float
    landmarks: np.ndarray


class FaceDetector:
    def __init__(self) -> None:
        self.model = cv2.FaceDetectorYN.create(
            model=settings.detection_model_path,
            config="",
            input_size=(320, 320),
            score_threshold=settings.face_detection_threshold,
            nms_threshold=0.3,
            top_k=5000,
        )

    def detect(self, image: np.ndarray) -> list[FaceDetection]:
        if image is None or image.size == 0:
            raise ValueError("Invalid image")

        height, width = image.shape[:2]

        self.model.setInputSize((width, height))

        _, faces = self.model.detect(image)

        if faces is None:
            return []

        results: list[FaceDetection] = []

        for face in faces:
            x, y, w, h = face[:4]
            landmarks = face[4:14]
            confidence = float(face[14])

            results.append(
                FaceDetection(
                    x=int(x),
                    y=int(y),
                    width=int(w),
                    height=int(h),
                    confidence=confidence,
                    landmarks=landmarks.reshape(5, 2),
                )
            )

        return results