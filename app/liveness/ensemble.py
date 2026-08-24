from __future__ import annotations
from dataclasses import dataclass
import cv2
import numpy as np
import onnxruntime as ort


@dataclass
class LivenessResult:
    is_live: bool
    score: float
    label: str
    probabilities: list[float]


class MiniFASNetEnsemble:
    # The Official Minivision Classes
    LABELS = {
        0: "print_attack",
        1: "live",  # Index 1 is the Real Face!
        2: "replay_attack",
    }
    LIVE_CLASS = 1

    def __init__(
            self,
            v2_path: str,
            v1se_path: str,
            threshold: float = 0.50,
    ) -> None:
        self.threshold = threshold
        self.v2_session = ort.InferenceSession(v2_path, providers=["CPUExecutionProvider"])
        self.v1se_session = ort.InferenceSession(v1se_path, providers=["CPUExecutionProvider"])
        self.v2_input = self.v2_session.get_inputs()[0].name
        self.v1se_input = self.v1se_session.get_inputs()[0].name


    @staticmethod
    def _crop(
            image: np.ndarray,
            bbox: tuple[int, int, int, int],
            scale: float,
    ) -> np.ndarray:
        x, y, w, h = bbox
        center_x = x + w / 2.0
        center_y = y + h / 2.0

        # 1. Calculate the ideal square crop size
        size = max(w, h)
        crop_size = int(size * scale)
        img_h, img_w = image.shape[:2]

        # 2. If the AI wants to zoom out larger than your camera resolution, shrink it to fit
        max_possible_size = min(img_w, img_h)
        if crop_size > max_possible_size:
            crop_size = max_possible_size

        # 3. Calculate ideal top-left corner
        left = int(center_x - crop_size / 2.0)
        top = int(center_y - crop_size / 2.0)

        # 4. THE FIX: Shift the box to stay inside the image! No black padding!
        if left < 0:
            left = 0
        if top < 0:
            top = 0
        if left + crop_size > img_w:
            left = img_w - crop_size
        if top + crop_size > img_h:
            top = img_h - crop_size

        # 5. Extract the perfect, 100% natural square crop
        return image[top:top + crop_size, left:left + crop_size]

    @staticmethod
    def _prepare(crop: np.ndarray) -> np.ndarray:
        # Minivision expects BGR! No RGB conversion here.
        crop = cv2.resize(crop, (80, 80), interpolation=cv2.INTER_LINEAR)
        tensor = crop.astype(np.float32)
        tensor = np.transpose(tensor, (2, 0, 1))
        tensor = np.expand_dims(tensor, axis=0)
        return tensor

    @staticmethod
    def _softmax(x: np.ndarray) -> np.ndarray:
        x = x - np.max(x)
        exp_x = np.exp(x)
        return exp_x / np.sum(exp_x)

    def _infer(self, session: ort.InferenceSession, input_name: str, tensor: np.ndarray) -> np.ndarray:
        output = session.run(None, {input_name: tensor})[0]
        return np.asarray(output[0], dtype=np.float32)

    def predict(
            self,
            image: np.ndarray,
            bbox: tuple[int, int, int, int],
    ) -> LivenessResult:
        # Model 1: V2 (Scale 2.7)
        crop_v2 = self._crop(image=image, bbox=bbox, scale=2.7)
        cv2.imwrite("debug_crop_v2.jpg", crop_v2)
        tensor_v2 = self._prepare(crop_v2)
        logits_v2 = self._infer(self.v2_session, self.v2_input, tensor_v2)
        prob_v2 = self._softmax(logits_v2)

        # Model 2: V1SE (Scale 4.0)
        crop_v1se = self._crop(image=image, bbox=bbox, scale=4.0)
        cv2.imwrite("debug_crop_v1se.jpg", crop_v1se)
        tensor_v1se = self._prepare(crop_v1se)
        logits_v1se = self._infer(self.v1se_session, self.v1se_input, tensor_v1se)
        prob_v1se = self._softmax(logits_v1se)

        # Ensemble Logic
        probabilities = (prob_v2 + prob_v1se) / 2.0
        predicted_class = int(np.argmax(probabilities))
        live_score = float(probabilities[self.LIVE_CLASS])

        return LivenessResult(
            is_live=(predicted_class == self.LIVE_CLASS and live_score >= self.threshold),
            score=live_score,
            label=self.LABELS[predicted_class],
            probabilities=probabilities.tolist(),
        )