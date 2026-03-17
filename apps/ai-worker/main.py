"""
IADivulger AI Worker — FastAPI Application Entry Point
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
A lightweight async microservice that wraps local AI inference engines:
  - ComfyUI (Wan 2.6 / FLUX) → video and image generation
  - Qwen3-TTS               → text-to-speech narration

Run locally:
  uvicorn main:app --reload --port 8000

Env:
  Copy .env.example to .env and adjust paths / ports.
"""

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from config import get_settings
from routes.generate import router as generate_router

settings = get_settings()


# ─── Logging setup ───────────────────────────────────────────────────────────

logger.remove()
logger.add(
    sys.stderr,
    level=settings.log_level,
    format=(
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> — "
        "<level>{message}</level>"
    ),
    colorize=True,
)

# Persistent file log — enqueue=True prevents PermissionError when multiple
# python processes start simultaneously (e.g., after a restart).
logger.add(
    "worker_full.log",
    level="DEBUG",
    rotation="10 MB",
    retention="1 week",
    enqueue=True,  # <-- async safe multi-process logging
)


# ─── Startup / Shutdown ──────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(application: FastAPI):
    """Ensure asset directories exist on startup."""
    logger.info("🤖 IADivulger AI Worker starting up…")

    for dir_path in (
        settings.assets_base_dir,
        settings.assets_video_dir,
        settings.assets_audio_dir,
        settings.assets_image_dir,
    ):
        Path(dir_path).mkdir(parents=True, exist_ok=True)

    logger.info(f"📁 Asset directories ready under '{settings.assets_base_dir}'")
    logger.info(f"🎨 ComfyUI endpoint  → {settings.comfyui_url}")
    logger.info(f"🔊 Qwen TTS endpoint → {settings.qwen_tts_url}")
    logger.info(f"🧪 Mock Mode        → {settings.use_mock}")
    logger.success(f"🚀 AI Worker listening on port {settings.ai_worker_port}")

    yield  # <-- application runs here

    logger.info("AI Worker shutting down.")


# ─── App factory ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="IADivulger AI Worker",
    description=(
        "Internal microservice for GPU-accelerated asset generation. "
        "Wraps ComfyUI (video/image) and Qwen3-TTS (narration)."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routes ──────────────────────────────────────────────────────────────────
from fastapi.staticfiles import StaticFiles

app.include_router(generate_router)

# Serve internal assets statically (both paths for backwards compatibility)
app.mount("/assets/internal", StaticFiles(directory=settings.assets_base_dir), name="internal_assets")
app.mount("/assets", StaticFiles(directory=settings.assets_base_dir), name="assets")


@app.get("/health", tags=["system"], summary="Basic liveness probe")
async def root_health():
    return {"status": "ok", "service": "iadivulger-ai-worker"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
