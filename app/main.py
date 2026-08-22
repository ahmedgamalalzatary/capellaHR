from fastapi import FastAPI

from app.api.detect import router as detect_router
from app.api.health import router as health_router
from app.api.verify import router as verify_router
from app.core.config import settings


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
)

app.include_router(
    health_router,
    prefix="/api/v1",
)

app.include_router(
    verify_router,
    prefix="/api/v1",
)

app.include_router(
    detect_router,
    prefix="/api/v1",
)