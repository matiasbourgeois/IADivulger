"""
Kokoro TTS Client for IADivulger AI Worker
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Reemplaza al QwenTTSClient. Mismo contrato de API pública — drop-in replacement.

Mejoras clave sobre el cliente anterior:
  - Lee el header X-Audio-Duration-Seconds de la respuesta → duración real del audio
  - Retorna AudioResult con duration_ms real (no estimado)
  - Manejo de errores específicos de Kokoro
  - Consistent voice: em_alex por defecto
"""

import time
from pathlib import Path

import aiofiles
import httpx
from loguru import logger

from config import get_settings

settings = get_settings()


class KokoroTTSError(Exception):
    """Base exception para errores de Kokoro TTS."""


class KokoroTTSOfflineError(KokoroTTSError):
    """El servidor de TTS no está disponible."""


class AudioResult:
    """Resultado de generación de audio con duración real medida."""
    def __init__(self, path: Path, duration_ms: int, voice: str):
        self.path = path
        self.duration_ms = duration_ms
        self.duration_seconds = duration_ms / 1000
        self.voice = voice

    def __repr__(self):
        return f"AudioResult(path={self.path.name}, duration={self.duration_seconds:.2f}s, voice={self.voice})"


class KokoroTTSClient:
    """
    Cliente async HTTP para el servidor local Kokoro TTS.

    Uso:
        async with KokoroTTSClient() as client:
            result = await client.generate(text, output_dir="./assets/audio")
            print(f"Audio: {result.path}, Duración: {result.duration_seconds:.2f}s")
    """

    def __init__(self) -> None:
        # Mismo env var que el cliente anterior para compatibilidad
        self._base_url = settings.qwen_tts_url
        self._http: httpx.AsyncClient | None = None
        self._default_voice = getattr(settings, 'kokoro_voice', 'em_alex')

    async def __aenter__(self) -> "KokoroTTSClient":
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=300.0,  # TTS puede tardar en textos largos
        )
        return self

    async def __aexit__(self, *_) -> None:
        if self._http:
            await self._http.aclose()

    # ─── Public API ──────────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """True si el servidor responde correctamente."""
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
    ) -> AudioResult:
        """
        Sintetiza texto a voz y guarda el WAV resultante.

        Returns:
            AudioResult con path al archivo y duración REAL medida desde el servidor.

        Raises:
            KokoroTTSOfflineError si el servidor no está corriendo.
            KokoroTTSError para otros errores de síntesis.
        """
        await self._assert_online()

        voice = voice_id or self._default_voice
        payload = {
            "text": text.strip(),
            "speed": speed,
            "language": language,
            "voice_id": voice,
        }

        logger.info(
            f"[Kokoro] Sintetizando | voz={voice} speed={speed} chars={len(text)}"
        )

        try:
            resp = await self._http.post("/generate", json=payload)
        except httpx.ConnectError:
            raise KokoroTTSOfflineError(
                f"Perdida conexión con Kokoro TTS en {self._base_url}. "
                "Asegurate que el servidor esté corriendo."
            )

        if resp.status_code != 200:
            raise KokoroTTSError(
                f"Kokoro TTS devolvió HTTP {resp.status_code}: {resp.text}"
            )

        audio_bytes = resp.content
        if not audio_bytes:
            raise KokoroTTSError("Kokoro TTS devolvió respuesta vacía.")

        # ── Leer duración REAL desde el header (clave del fix de sincronía) ──
        duration_ms = self._parse_duration_header(resp.headers, audio_bytes)
        voice_used = resp.headers.get("X-Voice-Used", voice)

        path = await self._save_audio(audio_bytes, output_dir, filename_prefix)

        result = AudioResult(path=path, duration_ms=duration_ms, voice=voice_used)
        logger.success(
            f"[Kokoro] ✓ Guardado: {path.name} | "
            f"duración real: {result.duration_seconds:.2f}s | voz: {voice_used}"
        )
        return result

    # ─── Private ─────────────────────────────────────────────────────────────

    def _parse_duration_header(
        self, headers: httpx.Headers, audio_bytes: bytes
    ) -> int:
        """
        Lee X-Audio-Duration-Seconds del header.
        Fallback: calcula duración desde el tamaño del WAV (menos preciso).
        """
        header_val = headers.get("X-Audio-Duration-Seconds")
        if header_val:
            try:
                return int(float(header_val) * 1000)
            except ValueError:
                pass

        # Fallback: calcular desde bytes WAV (PCM 16-bit mono 24kHz)
        # WAV header = 44 bytes, PCM_16 = 2 bytes/sample
        pcm_bytes = max(0, len(audio_bytes) - 44)
        samples = pcm_bytes // 2
        duration_s = samples / 24000  # Kokoro usa 24kHz
        logger.warning(
            "[Kokoro] Header X-Audio-Duration-Seconds ausente — "
            f"calculando desde bytes: {duration_s:.2f}s"
        )
        return int(duration_s * 1000)

    async def _assert_online(self) -> None:
        if not await self.health_check():
            raise KokoroTTSOfflineError(
                f"Servidor Kokoro TTS no disponible en {self._base_url}. "
                "Ejecutá: cd apps/tts-server && python main.py"
            )

    @staticmethod
    async def _save_audio(audio_bytes: bytes, output_dir: str, prefix: str) -> Path:
        """Guarda los bytes de audio en disco y retorna el path."""
        dest_dir = Path(output_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / f"{prefix}_{int(time.time() * 1000)}.wav"
        async with aiofiles.open(dest_path, "wb") as f:
            await f.write(audio_bytes)
        return dest_path
