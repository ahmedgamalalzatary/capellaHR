from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort


MODEL = Path("models/liveness/4_0_0_80x80_MiniFASNetV1SE.onnx")
IMAGE = Path("test/unit/print.JPG")


def softmax(x: np.ndarray) -> np.ndarray:
    x = x - np.max(x)
    e = np.exp(x)
    return e / e.sum()


def main():
    session = ort.InferenceSession(
        str(MODEL),
        providers=["CPUExecutionProvider"],
    )

    print("MODEL:", MODEL)
    print()

    for inp in session.get_inputs():
        print("INPUT")
        print(" name :", inp.name)
        print(" shape:", inp.shape)
        print(" type :", inp.type)

    for out in session.get_outputs():
        print("\nOUTPUT")
        print(" name :", out.name)
        print(" shape:", out.shape)
        print(" type :", out.type)

    image = cv2.imread(str(IMAGE))

    if image is None:
        raise RuntimeError(
            f"Could not load {IMAGE}"
        )

    print("\nIMAGE:", image.shape)

    # IMPORTANT:
    # This diagnostic is only to inspect the ONNX model.
    # It is NOT our final liveness pipeline.
    h, w = image.shape[:2]

    crop = image[
        0:h,
        0:w,
    ]

    crop = cv2.resize(
        crop,
        (80, 80),
    )

    tensor = crop.astype(
        np.float32
    ) / 255.0

    tensor = np.transpose(
        tensor,
        (2, 0, 1),
    )

    tensor = np.expand_dims(
        tensor,
        axis=0,
    )

    raw = session.run(
        None,
        {
            session.get_inputs()[0].name: tensor
        },
    )[0][0]

    raw = np.asarray(
        raw,
        dtype=np.float32,
    )

    print("\nRAW OUTPUT:")
    print(raw)

    probabilities = softmax(raw)

    print("\nSOFTMAX:")
    print(probabilities)

    print("\nARGMAX:")
    print(int(np.argmax(probabilities)))


if __name__ == "__main__":
    main()