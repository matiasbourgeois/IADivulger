"""
Pydantic schemas for the AI Worker API.
All request and response bodies are defined here.
"""
from pydantic import BaseModel, Field


# ─── Shared ──────────────────────────────────────────────────────────────────

class VoiceOptions(BaseModel):
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    language: str = Field(default="es")
    voice_id: str | None = None


# ─── Audio ───────────────────────────────────────────────────────────────────

class AudioGenerateRequest(BaseModel):
    scene_id: str = Field(..., description="Unique ID of the scene being processed")
    text: str = Field(..., min_length=1, description="Narration text to synthesize")
    voice_options: VoiceOptions = Field(default_factory=VoiceOptions)
    output_filename_prefix: str = Field(default="narration")


class AudioGenerateResponse(BaseModel):
    scene_id: str
    audio_path: str
    duration_ms: int = Field(default=0, description="Duración real del audio generado en ms")
    provider: str = "Kokoro-Local"


# ─── Video ───────────────────────────────────────────────────────────────────

class VideoGenerateRequest(BaseModel):
    scene_id: str = Field(..., description="Unique ID of the scene")
    visual_prompt: str = Field(..., min_length=1, description="Prompt for ComfyUI")
    workflow: dict = Field(
        ...,
        description=(
            "Full ComfyUI API-format workflow JSON. "
            "The caller (Backend Orchestrator) injects the prompt into this workflow. "
            "For example, set the 'text' field of a CLIP Text Encode node."
        ),
    )
    output_filename_prefix: str = Field(default="scene")


class VideoGenerateResponse(BaseModel):
    scene_id: str
    prompt_id: str | None = None
    asset_path: str
    provider: str = "ComfyUI-Local"


class VideoQueueResponse(BaseModel):
    scene_id: str
    prompt_id: str
    provider: str = "ComfyUI-Local"


# ─── Image ───────────────────────────────────────────────────────────────────

class ImageGenerateRequest(BaseModel):
    scene_id: str = Field(..., description="Unique ID of the scene")
    visual_prompt: str = Field(..., min_length=1, description="Prompt for FLUX image generation")
    workflow: dict = Field(
        ...,
        description="Full ComfyUI API-format workflow JSON for FLUX image generation.",
    )
    output_filename_prefix: str = Field(default="keyframe")


class ImageGenerateResponse(BaseModel):
    scene_id: str
    prompt_id: str | None = None
    image_path: str
    image_filename: str
    provider: str = "FLUX2-Klein-Local"


# ─── Health ──────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    comfyui_online: bool
    tts_online: bool


class ProgressResponse(BaseModel):
    current_step: int
    total_steps: int
    percentage: int
    prompt_id: str | None = None
