"""
Qwen TTS Client
~~~~~~~~~~~~~~~
Handles communication with a locally-running Qwen3-TTS HTTP server.

Assumed API contract (adjust to actual Qwen server endpoint):
  POST /generate
  Body JSON: { "text": str, "speed": float, "language": str }
  Response:  raw audio bytes (WAV) or JSON with a file path

Error handling covers:
  - TTS server offline
  - Invalid / empty response
  - Disk write failures
"""

from pathlib import Path

import aiofiles
import httpx
from loguru import logger

from config import get_settings

settings = get_settings()


class QwenTTSError(Exception):
    """Base exception for Qwen TTS errors."""


class QwenTTSOfflineError(QwenTTSError):
    """Raised when the TTS server is not reachable."""


class QwenTTSClient:
    """
    Async HTTP client for the local Qwen3-TTS server.

    Usage:
        async with QwenTTSClient() as client:
            audio_path = await client.generate(text, speed=1.0, language="es", output_dir="./assets/audio")
    """

    def __init__(self) -> None:
        self._base_url = settings.qwen_tts_url
        self._http: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "QwenTTSClient":
        self._http = httpx.AsyncClient(base_url=self._base_url, timeout=300.0)
        return self

    async def __aexit__(self, *_) -> None:
        if self._http:
            await self._http.aclose()

    # ─── Public API ──────────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """Return True if the TTS server responds."""
        try:
            resp = await self._http.get("/health")
            return resp.status_code == 200
        except (httpx.ConnectError, httpx.ConnectTimeout):
            return False

    async def generate(
        self,
        text: str,
        *,
        speed: float = 1.0,
        language: str = "es",
        voice_id: str | None = None,
        output_dir: str,
        filename_prefix: str = "narration",
    ) -> Path:
        """
        Request speech synthesis and save the resulting WAV file.

        Args:
            text:            Text to synthesize.
            speed:           Speech speed multiplier (0.5 – 2.0).
            language:        BCP-47 language tag, e.g. 'es', 'en'.
            voice_id:        Optional speaker / voice model ID.
            output_dir:      Directory where the .wav will be saved.
            filename_prefix: Prefix for the output filename.

        Returns:
            Path to the saved .wav file.

        Raises:
            QwenTTSOfflineError if the server is unreachable.
            QwenTTSError for any other synthesis failure.
        """
        await self._assert_online()

        payload: dict = {"text": text, "speed": speed, "language": language}
        if voice_id:
            payload["voice_id"] = voice_id

        logger.info(f"[QwenTTS] Generating speech | lang={language} speed={speed} chars={len(text)}")

        try:
            resp = await self._http.post("/generate", json=payload)
        except httpx.ConnectError:
            raise QwenTTSOfflineError(
                f"Lost connection to Qwen TTS at {self._base_url}. "
                "Make sure the TTS server is running."
            )

        if resp.status_code != 200:
            raise QwenTTSError(
                f"Qwen TTS returned HTTP {resp.status_code}: {resp.text}"
            )

        # The server should return raw audio bytes with Content-Type audio/wav
        audio_bytes = resp.content
        if not audio_bytes:
            raise QwenTTSError("Qwen TTS returned an empty response body.")

        return await self._save_audio(audio_bytes, output_dir, filename_prefix)

    # ─── Private helpers ─────────────────────────────────────────────────────

    async def _assert_online(self) -> None:
        if not await self.health_check():
            raise QwenTTSOfflineError(
                f"Qwen TTS server is not reachable at {self._base_url}. "
                "Please start it before requesting audio generation."
            )

    @staticmethod
    async def _save_audio(audio_bytes: bytes, output_dir: str, prefix: str) -> Path:
        """Write audio bytes to disk and return the path."""
        dest_dir = Path(output_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)

        import time
        dest_path = dest_dir / f"{prefix}_{int(time.time() * 1000)}.wav"

        async with aiofiles.open(dest_path, "wb") as f:
            await f.write(audio_bytes)

        logger.success(f"[QwenTTS] Audio saved → {dest_path}")
        return dest_path
