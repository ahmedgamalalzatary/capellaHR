from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "Attendance AI Service"
    app_version: str = "0.1.0"

    detection_model_path: str = (
        str(BASE_DIR / "models" / "detection" / "face_detection_yunet_2023mar.onnx")
    )

    liveness_model_path: str = (
        str(BASE_DIR / "models" / "liveness" / "minifasnet_v2.onnx")
    )

    face_detection_threshold: float = 0.6
    liveness_threshold: float = 0.50

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()