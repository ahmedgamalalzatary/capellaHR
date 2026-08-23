from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "Attendance AI Service"
    app_version: str = "0.1.0"

    detection_model_path: str = (
        str(BASE_DIR / "models" / "detection" / "face_detection_yunet_2023mar.onnx")
    )

    liveness_v2_model_path: str = (
        str(BASE_DIR / "models" / "liveness" / "2.7_80x80_MiniFASNetV2.onnx")
    )

    liveness_v1se_model_path: str = (
        str(BASE_DIR / "models" / "liveness" / "4_0_0_80x80_MiniFASNetV1SE.onnx")
    )

    # --- NEW: Recognition Settings ---
    recognition_model_path: str = (
        str(BASE_DIR / "models" / "recognition" / "face_recognizer_fast.onnx")
    )

    face_recognition_threshold: float = 0.363
    # ---------------------------------

    liveness_threshold: float = 0.50
    face_detection_threshold: float = 0.6

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()