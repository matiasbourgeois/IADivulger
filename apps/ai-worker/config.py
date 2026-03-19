"""
AI Worker — Typed Configuration
Loads all settings from environment variables / .env file.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server
    ai_worker_port: int = 8000
    log_level: str = "INFO"
    use_mock: bool = False # renamed to be more explicit if needed, but let's try just lower case first or add env_prefix

    # ComfyUI
    comfyui_url: str = "http://127.0.0.1:8189"
    comfyui_ws_url: str = "ws://127.0.0.1:8189"
    comfyui_poll_interval_s: float = 2.0
    comfyui_timeout_s: float = 3600.0
    comfyui_input_dir: str = "../comfyui/input"  # Where LoadImage looks for files

    # Qwen TTS
    qwen_tts_url: str = "http://127.0.0.1:9000"

    # Asset storage
    assets_base_dir: str = "./assets"
    assets_video_dir: str = "./assets/video"
    assets_audio_dir: str = "./assets/audio"
    assets_image_dir: str = "./assets/images"


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings singleton."""
    return Settings()
