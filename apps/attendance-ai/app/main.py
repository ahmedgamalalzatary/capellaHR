from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.detect import router as detect_router
from app.api.liveness import router as liveness_router
from app.api.verify import router as verify_router
from app.api.enroll import router as enroll_router

from app.core.config import settings


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(
    health_router,
    prefix="/api/v1",
)

app.include_router(
    detect_router,
    prefix="/api/v1",
)

app.include_router(
    liveness_router,
    prefix="/api/v1",
)

app.include_router(
    enroll_router,
    prefix="/api/v1",
)

app.include_router(
    verify_router,
    prefix="/api/v1",
)

