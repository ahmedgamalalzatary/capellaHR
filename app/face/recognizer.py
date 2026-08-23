import cv2
import numpy as np
from app.face.detector import FaceDetection


class FaceRecognizer:
    def __init__(self, model_path: str):
        # Requires the face_recognizer_fast.onnx model
        self.recognizer = cv2.FaceRecognizerSF.create(
            model=model_path,
            config="",
        )

    def extract(self, image: np.ndarray, face: FaceDetection) -> np.ndarray:
        # Reconstruct the raw 14-element array expected by OpenCV
        bbox_array = [face.x, face.y, face.width, face.height]
        landmarks_array = face.landmarks.flatten().tolist()
        raw_face = np.array(bbox_array + landmarks_array, dtype=np.float32)

        # Align and extract
        aligned_face = self.recognizer.alignCrop(image, raw_face)
        feature = self.recognizer.feature(aligned_face)
        return feature[0]

    def match(
            self,
            feature1: np.ndarray,
            feature2: np.ndarray,
            threshold: float = 0.363
    ) -> tuple[bool, float]:
        score = self.recognizer.match(
            feature1,
            feature2,
            cv2.FaceRecognizerSF_FR_COSINE
        )
        return score >= threshold, float(score)