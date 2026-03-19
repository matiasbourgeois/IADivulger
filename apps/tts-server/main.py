"""
IADivulger TTS Server — Kokoro TTS
====================================
Reemplaza el servidor Qwen3-TTS por Kokoro TTS con voz em_alex (español masculino latinoam.)

Características:
  - Voz consistente: siempre em_alex (español masculino natural)
  - Retorna la duración real del audio en el header X-Audio-Duration-Seconds
  - Sin silencio inicial: trim automático de silence al inicio
  - API compatible con el cliente anterior (mismo contrato POST /generate)
  - Endpoint /voices para listar voces disponibles

Futuro: este servidor soportará F5-TTS para voice cloning con audio de referencia.

Uso:
  pip install kokoro soundfile numpy
  python main.py  (puerto 9000)
"""

import io
import time
import wave
import struct
import os
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from loguru import logger

# ─── Kokoro TTS Global ────────────────────────────────────────────────────────
tts_pipeline = None
VOICE = os.getenv("KOKORO_VOICE", "em_alex")      # voz en español masculino
SAMPLE_RATE = 24000                                  # Kokoro usa 24kHz por defecto
LANG_CODE = "e"                                      # 'e' = español en Kokoro

# ─── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global tts_pipeline
    logger.info("🔊 Cargando Kokoro TTS...")
    try:
        from kokoro import KPipeline
        tts_pipeline = KPipeline(lang_code=LANG_CODE)
        logger.success(f"✅ Kokoro TTS listo — voz: {VOICE} | lang: {LANG_CODE}")
    except ImportError:
        logger.error("❌ Kokoro no instalado. Ejecutá: pip install kokoro soundfile")
        tts_pipeline = None
    except Exception as e:
        logger.error(f"❌ Error cargando Kokoro: {e}")
        tts_pipeline = None
    yield
    logger.info("Kokoro TTS server apagándose.")


app = FastAPI(
    title="IADivulger Kokoro TTS Server",
    description="Text-to-Speech con Kokoro — voz em_alex español masculino",
    version="2.0.0",
    lifespan=lifespan,
)


# ─── Health Check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check for preflight validation."""
    return {
        "status": "ok" if tts_pipeline is not None else "loading",
        "model": "kokoro",
        "voice": VOICE,
        "ready": tts_pipeline is not None,
    }


# ─── Schemas ──────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    text: str
    voice_description: str = "Professional clear male voice"
    speed: float = 1.0
    language: str = "es"
    voice_id: str | None = None   # override de voz (ej: "em_santa")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_audio_duration_seconds(audio_array: np.ndarray, sample_rate: int) -> float:
    """Calcula la duración real del audio en segundos."""
    return len(audio_array) / sample_rate


def trim_leading_silence(audio: np.ndarray, threshold: float = 0.01, sr: int = 24000) -> np.ndarray:
    """Elimina el silencio al inicio del audio."""
    if len(audio) == 0:
        return audio
    # Buscar primer sample que supere el umbral
    abs_audio = np.abs(audio)
    nonsilent = np.where(abs_audio > threshold)[0]
    if len(nonsilent) == 0:
        return audio
    start = max(0, nonsilent[0] - int(sr * 0.05))  # 50ms de margen
    return audio[start:]


def audio_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    """Convierte array de numpy a bytes WAV en memoria."""
    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format="WAV", subtype="PCM_16")
    buffer.seek(0)
    return buffer.read()


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/generate")
async def generate(req: GenerateRequest):
    """
    Genera audio WAV para el texto dado.
    Retorna el WAV como streaming response.
    Header X-Audio-Duration-Seconds: duración real del audio generado.
    """
    if tts_pipeline is None:
        raise HTTPException(
            status_code=503,
            detail="Kokoro TTS no está cargado. Verificá la instalación."
        )

    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")

    voice = req.voice_id or VOICE
    text = req.text.strip()

    logger.info(f"[Kokoro] Generando | voz={voice} | chars={len(text)} | speed={req.speed}")

    start_time = time.time()
    try:
        loop = asyncio.get_event_loop()
        audio_chunks = await loop.run_in_executor(
            None,
            lambda: list(tts_pipeline(text, voice=voice, speed=req.speed))
        )
    except Exception as e:
        logger.error(f"[Kokoro] Error en síntesis: {e}")
        raise HTTPException(status_code=500, detail=f"Error en síntesis TTS: {e}")

    # KPipeline 0.9.4 yields Result objects with .audio attribute (torch.Tensor)
    # (older API returned (graphemes, phonemes, audio) tuples — keep fallback)
    all_audio = []
    for chunk in audio_chunks:
        if hasattr(chunk, 'audio'):
            # New API: Result object
            audio_data = chunk.audio
        elif isinstance(chunk, tuple) and len(chunk) >= 3:
            # Old tuple API fallback
            audio_data = chunk[2]
        else:
            audio_data = chunk

        if audio_data is None:
            continue
        try:
            if hasattr(audio_data, 'detach'):
                arr = audio_data.detach().cpu().numpy().flatten().astype(np.float32)
            else:
                arr = np.array(audio_data, dtype=np.float32).flatten()
            if len(arr) > 0:
                all_audio.append(arr)
        except Exception as chunk_err:
            logger.warning(f"[Kokoro] Chunk skip: {chunk_err}")
            continue

    if not all_audio:
        raise HTTPException(status_code=500, detail="Kokoro generó audio vacío.")

    full_audio = np.concatenate(all_audio)

    # Trim silencio inicial
    full_audio = trim_leading_silence(full_audio, sr=SAMPLE_RATE)

    # Calcular duración real
    duration_s = get_audio_duration_seconds(full_audio, SAMPLE_RATE)
    gen_time = time.time() - start_time

    logger.success(
        f"[Kokoro] ✓ {duration_s:.2f}s de audio generado en {gen_time:.2f}s | voz={voice}"
    )

    # Convertir a WAV bytes
    wav_bytes = audio_to_wav_bytes(full_audio, SAMPLE_RATE)

    return StreamingResponse(
        io.BytesIO(wav_bytes),
        media_type="audio/wav",
        headers={
            "X-Audio-Duration-Seconds": f"{duration_s:.3f}",
            "X-Voice-Used": voice,
            "X-Generation-Time-Seconds": f"{gen_time:.3f}",
        }
    )


@app.get("/voices")
async def list_voices():
    """Lista las voces disponibles en español."""
    return {
        "voices": [
            {"id": "em_alex", "lang": "es", "gender": "male", "accent": "latinoam", "default": True},
            {"id": "em_santa", "lang": "es", "gender": "male", "accent": "latinoam", "default": False},
        ],
        "current_default": VOICE,
        "note": "Futuro: voice cloning con F5-TTS usando audio de referencia propio."
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "kokoro-tts",
        "model": "Kokoro",
        "voice": VOICE,
        "lang_code": LANG_CODE,
        "loaded": tts_pipeline is not None,
        "sample_rate": SAMPLE_RATE,
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("TTS_PORT", "9000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
