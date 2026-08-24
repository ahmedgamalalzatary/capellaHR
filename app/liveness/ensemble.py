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
    """
    Two-model Silent-Face-Anti-Spoofing ensemble.

    Model 1:
        MiniFASNetV2
        crop scale = 2.7

    Model 2:
        MiniFASNetV1SE
        crop scale = 4.0

    Output class order:
        0 = live
        1 = print attack
        2 = replay attack

    Final prediction:
        sum the logits from the two models,
        then apply softmax.
    """

    LABELS = {
        0: "replay_attack",
        1: "live",
        2: "print_attack",
    }
    LIVE_CLASS = 1


    def __init__(
        self,
        v2_path: str,
        v1se_path: str,
        threshold: float = 0.50,
    ) -> None:

        self.threshold = threshold

        self.v2_session = ort.InferenceSession(
            v2_path,
            providers=["CPUExecutionProvider"],
        )

        self.v1se_session = ort.InferenceSession(
            v1se_path,
            providers=["CPUExecutionProvider"],
        )

        self.v2_input = (
            self.v2_session.get_inputs()[0].name
        )

        self.v1se_input = (
            self.v1se_session.get_inputs()[0].name
        )


    @staticmethod
    def _crop(
            image: np.ndarray,
            bbox: tuple[int, int, int, int],
            scale: float,
    ) -> np.ndarray:
        x, y, w, h = bbox
        center_x = x + w / 2.0
        center_y = y + h / 2.0

        # FIX: Force a perfectly square crop to prevent aspect ratio distortion
        size = max(w, h)
        crop_size = int(size * scale)

        left = int(center_x - crop_size / 2)
        top = int(center_y - crop_size / 2)
        right = left + crop_size
        bottom = top + crop_size

        img_h, img_w = image.shape[:2]

        # Initialize a square canvas
        padded = np.zeros(
            (crop_size, crop_size, 3),
            dtype=image.dtype,
        )

        src_left = max(0, left)
        src_top = max(0, top)
        src_right = min(img_w, right)
        src_bottom = min(img_h, bottom)

        if src_right <= src_left or src_bottom <= src_top:
            raise ValueError("Invalid face crop")

        dst_left = src_left - left
        dst_top = src_top - top
        dst_right = dst_left + (src_right - src_left)
        dst_bottom = dst_top + (src_bottom - src_top)

        padded[
            dst_top:dst_bottom,
            dst_left:dst_right,
        ] = image[
            src_top:src_bottom,
            src_left:src_right,
        ]

        return padded

    @staticmethod
    def _prepare(crop: np.ndarray) -> np.ndarray:
        crop = cv2.resize(
            crop,
            (80, 80),
            interpolation=cv2.INTER_LINEAR,
        )

        # 🚨 THE REAL FIX: Convert BGR to RGB so your skin looks normal to the AI!
        crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)

        tensor = crop.astype(np.float32) / 255.0
        tensor = np.transpose(tensor, (2, 0, 1))
        tensor = np.expand_dims(tensor, axis=0)

        return tensor

    @staticmethod
    def _softmax(
        x: np.ndarray,
    ) -> np.ndarray:

        x = x - np.max(x)

        exp_x = np.exp(x)

        return exp_x / np.sum(exp_x)

    def _infer(
        self,
        session: ort.InferenceSession,
        input_name: str,
        tensor: np.ndarray,
    ) -> np.ndarray:

        output = session.run(
            None,
            {
                input_name: tensor,
            },
        )[0]

        return np.asarray(
            output[0],
            dtype=np.float32,
        )


    def predict(
            self,
            image: np.ndarray,
            bbox: tuple[int, int, int, int],
    ) -> LivenessResult:
        # --------------------------------------------
        # Model 1: MiniFASNetV2 - scale 2.7
        # --------------------------------------------
        crop_v2 = self._crop(image=image, bbox=bbox, scale=2.7)
        tensor_v2 = self._prepare(crop_v2)
        logits_v2 = self._infer(
            session=self.v2_session,
            input_name=self.v2_input,
            tensor=tensor_v2,
        )
        # Softmax INDIVIDUALLY
        prob_v2 = self._softmax(logits_v2)

        # --------------------------------------------
        # Model 2: MiniFASNetV1SE - scale 4.0
        # --------------------------------------------
        crop_v1se = self._crop(image=image, bbox=bbox, scale=4.0)
        tensor_v1se = self._prepare(crop_v1se)
        logits_v1se = self._infer(
            session=self.v1se_session,
            input_name=self.v1se_input,
            tensor=tensor_v1se,
        )
        # Softmax INDIVIDUALLY
        prob_v1se = self._softmax(logits_v1se)

        # --------------------------------------------
        # Ensemble (Average the probabilities)
        # --------------------------------------------
        probabilities = (prob_v2 + prob_v1se) / 2.0

        predicted_class = int(np.argmax(probabilities))
        live_score = float(probabilities[self.LIVE_CLASS])

        return LivenessResult(
            is_live=(
                    predicted_class == self.LIVE_CLASS
                    and live_score >= self.threshold
            ),
            score=live_score,
            label=self.LABELS[predicted_class],
            probabilities=probabilities.tolist(),
        )