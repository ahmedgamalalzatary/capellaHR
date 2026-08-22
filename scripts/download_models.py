from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from urllib.request import Request, urlopen


# ============================================================
# Project paths
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = PROJECT_ROOT / "models"


# ============================================================
# Models
# ============================================================

MODELS = {
    "yunet": {
        "url": (
            "https://github.com/opencv/opencv_zoo/raw/"
            "refs/heads/main/models/face_detection_yunet/"
            "face_detection_yunet_2023mar.onnx"
        ),
        "path": (
            MODELS_DIR
            / "detection"
            / "face_detection_yunet_2023mar.onnx"
        ),
        "sha256": None,
    },

    "minifasnet": {
        "url": (
            "https://huggingface.co/garciafido/"
            "minifasnet-v2-anti-spoofing-onnx/"
            "resolve/main/minifasnet_v2.onnx"
        ),
        "path": (
            MODELS_DIR
            / "liveness"
            / "minifasnet_v2.onnx"
        ),
        "sha256": (
            "d7b3cd9ba8a7ceb13baa8c4720902e27"
            "ca3112eff52f926c08804af6b6eecc7b"
        ),
    },
}


# ============================================================
# SHA-256
# ============================================================

def calculate_sha256(file_path: Path) -> str:
    sha256 = hashlib.sha256()

    with file_path.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            sha256.update(chunk)

    return sha256.hexdigest()


# ============================================================
# Download
# ============================================================

def download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    print(f"Downloading:")
    print(f"  {url}")

    print(f"Saving to:")
    print(f"  {destination}")

    request = Request(
        url,
        headers={
            "User-Agent": "attendance-ai-model-downloader/1.0"
        },
    )

    try:
        with urlopen(request) as response:
            total_size = response.headers.get("Content-Length")

            total_size = (
                int(total_size)
                if total_size is not None
                else None
            )

            downloaded = 0

            with destination.open("wb") as file:
                while True:
                    chunk = response.read(1024 * 1024)

                    if not chunk:
                        break

                    file.write(chunk)
                    downloaded += len(chunk)

                    if total_size:
                        percentage = (
                            downloaded / total_size
                        ) * 100

                        print(
                            f"\rProgress: {percentage:.1f}%",
                            end="",
                        )

            print()

    except Exception:
        if destination.exists():
            destination.unlink()

        raise


# ============================================================
# Verify
# ============================================================

def verify_model(
    model_name: str,
    model_path: Path,
    expected_sha256: str | None,
) -> bool:

    print(f"\nVerifying {model_name}...")

    if not model_path.exists():
        print("ERROR: Model file does not exist.")
        return False

    actual_sha256 = calculate_sha256(model_path)

    print(f"SHA-256:")
    print(f"  {actual_sha256}")

    if expected_sha256 is None:
        print(
            "WARNING: No SHA-256 is configured for this model."
        )
        print(
            "The file was downloaded, but its integrity "
            "cannot be automatically verified."
        )
        return True

    if actual_sha256.lower() != expected_sha256.lower():
        print("ERROR: SHA-256 mismatch!")
        print(f"Expected: {expected_sha256}")
        print(f"Actual:   {actual_sha256}")

        model_path.unlink()

        return False

    print("SHA-256: OK")

    return True


# ============================================================
# Main
# ============================================================

def download_model(
    model_name: str,
    config: dict,
) -> bool:

    path = config["path"]
    url = config["url"]
    expected_sha256 = config["sha256"]

    print("\n" + "=" * 60)
    print(f"Model: {model_name}")
    print("=" * 60)

    # --------------------------------------------------------
    # Already exists
    # --------------------------------------------------------

    if path.exists():

        print(f"Model already exists:")
        print(f"  {path}")

        if verify_model(
            model_name,
            path,
            expected_sha256,
        ):
            print("Using existing model.")
            return True

        print("Existing model is invalid.")
        print("Downloading a fresh copy...")

    # --------------------------------------------------------
    # Download
    # --------------------------------------------------------

    try:
        download_file(
            url,
            path,
        )

    except Exception as error:
        print(f"\nERROR downloading {model_name}:")
        print(error)

        return False

    # --------------------------------------------------------
    # Verify
    # --------------------------------------------------------

    return verify_model(
        model_name,
        path,
        expected_sha256,
    )


def main() -> int:

    print("=" * 60)
    print("Attendance AI - Model Downloader")
    print("=" * 60)

    success = True

    for model_name, config in MODELS.items():

        result = download_model(
            model_name,
            config,
        )

        if not result:
            success = False

    print("\n" + "=" * 60)

    if success:
        print("All models are ready.")
        print("=" * 60)
        return 0

    print("One or more models failed.")
    print("=" * 60)

    return 1


if __name__ == "__main__":
    sys.exit(main())