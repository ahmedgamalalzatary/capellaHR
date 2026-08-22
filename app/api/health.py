from fastapi import APIRouter

from app.core.config import settings
from app.schemas.response import HealthResponse


router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=settings.app_version,
    )