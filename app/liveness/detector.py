# from dataclasses import dataclass
#
# import cv2
# import numpy as np
# import onnxruntime as ort
#
#
# @dataclass
# class LivenessResult:
#     is_live: bool
#     score: float
#     label: str
#
#
# class LivenessDetector:
#
#     LABELS = [
#         "live",
#         "print_attack",
#         "replay_attack",
#     ]
#
#     def __init__(
#         self,
#         model_path: str,
#         threshold: float = 0.50,
#     ) -> None:
#
#         self.threshold = threshold
#
#         self.session = ort.InferenceSession(
#             model_path,
#             providers=["CPUExecutionProvider"],
#         )
#
#         self.input_name = self.session.get_inputs()[0].name
#
#     @staticmethod
#     def _crop_face(
#         image: np.ndarray,
#         x: int,
#         y: int,
#         width: int,
#         height: int,
#         scale: float = 2.7,
#     ) -> np.ndarray:
#
#         center_x = x + width / 2
#         center_y = y + height / 2
#
#         crop_width = width * scale
#         crop_height = height * scale
#
#         left = int(center_x - crop_width / 2)
#         top = int(center_y - crop_height / 2)
#
#         right = int(center_x + crop_width / 2)
#         bottom = int(center_y + crop_height / 2)
#
#         img_h, img_w = image.shape[:2]
#
#         left = max(0, left)
#         top = max(0, top)
#         right = min(img_w, right)
#         bottom = min(img_h, bottom)
#
#         crop = image[top:bottom, left:right]
#
#         if crop.size == 0:
#             raise ValueError("Invalid face crop")
#
#         return crop
#
#     def predict(
#         self,
#         image: np.ndarray,
#         x: int,
#         y: int,
#         width: int,
#         height: int,
#     ) -> LivenessResult:
#
#         crop = self._crop_face(
#             image=image,
#             x=x,
#             y=y,
#             width=width,
#             height=height,
#         )
#
#         crop = cv2.resize(
#             crop,
#             (80, 80),
#             interpolation=cv2.INTER_LINEAR,
#         )
#
#         tensor = crop.astype(np.float32) / 255.0
#
#         tensor = np.transpose(
#             tensor,
#             (2, 0, 1),
#         )
#
#         tensor = np.expand_dims(
#             tensor,
#             axis=0,
#         )
#
#         outputs = self.session.run(
#             None,
#             {
#                 self.input_name: tensor,
#             },
#         )
#
#         logits = np.asarray(
#             outputs[0][0],
#             dtype=np.float32,
#         )
#
#         probabilities = self._softmax(logits)
#
#         label_index = int(
#             np.argmax(probabilities)
#         )
#
#         label = self.LABELS[label_index]
#
#         live_score = float(
#             probabilities[0]
#         )
#
#         return LivenessResult(
#             is_live=(
#                 label == "live"
#                 and live_score >= self.threshold
#             ),
#             score=live_score,
#             label=label,
#         )
#
#     @staticmethod
#     def _softmax(
#         values: np.ndarray,
#     ) -> np.ndarray:
#
#         values = values - np.max(values)
#
#         exp_values = np.exp(values)
#
#         return exp_values / np.sum(exp_values)
from dataclasses import dataclass
import cv2
import numpy as np
import onnxruntime as ort

@dataclass
class LivenessResult:
    is_live: bool
    score: float
    label: str

class LivenessDetector:

    # Index 1 is 'live' in MiniFASNet / Silent-Face-Anti-Spoofing
    LABELS = [
        "print_attack",   # Index 0
        "live",           # Index 1
        "replay_attack",  # Index 2
    ]

    def __init__(
        self,
        model_path: str,
        threshold: float = 0.50,
    ) -> None:
        self.threshold = threshold
        self.session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name

    @staticmethod
    def _crop_face(
        image: np.ndarray,
        x: int,
        y: int,
        width: int,
        height: int,
        scale: float = 2.7,
    ) -> np.ndarray:
        center_x = x + width / 2
        center_y = y + height / 2

        crop_width = width * scale
        crop_height = height * scale

        left = int(center_x - crop_width / 2)
        top = int(center_y - crop_height / 2)
        right = int(center_x + crop_width / 2)
        bottom = int(center_y + crop_height / 2)

        img_h, img_w = image.shape[:2]

        left = max(0, left)
        top = max(0, top)
        right = min(img_w, right)
        bottom = min(img_h, bottom)

        crop = image[top:bottom, left:right]

        if crop.size == 0:
            raise ValueError("Invalid face crop")

        return crop

    def predict(
        self,
        image: np.ndarray,
        x: int,
        y: int,
        width: int,
        height: int,
    ) -> LivenessResult:

        crop = self._crop_face(
            image=image,
            x=x,
            y=y,
            width=width,
            height=height,
        )

        crop = cv2.resize(
            crop,
            (80, 80),
            interpolation=cv2.INTER_LINEAR,
        )

        # Convert OpenCV BGR to RGB expected by MiniFASNet
        crop_rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)

        tensor = crop_rgb.astype(np.float32) / 255.0
        tensor = np.transpose(tensor, (2, 0, 1))
        tensor = np.expand_dims(tensor, axis=0)

        outputs = self.session.run(
            None,
            {self.input_name: tensor},
        )

        logits = np.asarray(outputs[0][0], dtype=np.float32)
        probabilities = self._softmax(logits)

        label_index = int(np.argmax(probabilities))
        label = self.LABELS[label_index]

        # Extract score from index 1 (live class)
        live_score = float(probabilities[1])

        return LivenessResult(
            is_live=(label == "live" and live_score >= self.threshold),
            score=live_score,
            label=label,
        )

    @staticmethod
    def _softmax(values: np.ndarray) -> np.ndarray:
        values = values - np.max(values)
        exp_values = np.exp(values)
        return exp_values / np.sum(exp_values)