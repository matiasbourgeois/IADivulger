# IADivulger AI Worker

> **Módulo:** `apps/ai-worker` | **Runtime:** Python 3.11+ | **Framework:** FastAPI + Uvicorn

Microservicio asíncrono que actúa como intermediario entre el Backend Orchestrator (Node.js) y los motores de IA locales.

## Arquitectura

```
Backend Orchestrator (Node.js :3001)
        │
        │ HTTP POST /api/generate/audio
        │ HTTP POST /api/generate/video
        ▼
   AI Worker (FastAPI :8000)
        │
        ├── QwenTTSClient ──► Qwen3-TTS Server (:9000)
        │                         └── WAV saved to ./assets/audio/
        │
        └── ComfyUIClient ──► ComfyUI (:8188)
                  ├── POST /prompt        (queue workflow)
                  ├── WS   /ws            (poll completion)
                  ├── GET  /history       (get output info)
                  └── GET  /view          (download MP4/PNG)
                                └── saved to ./assets/video/
```

## Estructura de Archivos

```
apps/ai-worker/
├── main.py                       ← FastAPI app factory + lifespan
├── config.py                     ← Pydantic-Settings typed config
├── schemas.py                    ← Request/Response Pydantic models
├── requirements.txt
├── .env.example
├── clients/
│   ├── comfyui_client.py         ← WS polling + /view download
│   └── qwen_tts_client.py        ← HTTP TTS + WAV persistence
└── routes/
    └── generate.py               ← /api/generate/audio|video endpoints
```

## Instalación

```bash
cd apps/ai-worker
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
```

## Ejecución

```bash
uvicorn main:app --reload --port 8000
```

Documentación interactiva disponible en `http://localhost:8000/docs` una vez iniciado.

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `COMFYUI_URL` | `http://127.0.0.1:8188` | URL REST de ComfyUI |
| `COMFYUI_WS_URL` | `ws://127.0.0.1:8188` | URL WebSocket de ComfyUI |
| `COMFYUI_TIMEOUT_S` | `600` | Timeout máximo por render (segundos) |
| `QWEN_TTS_URL` | `http://127.0.0.1:9000` | URL del servidor Qwen3-TTS |
| `ASSETS_VIDEO_DIR` | `./assets/video` | Destino de MP4/PNG generados |
| `ASSETS_AUDIO_DIR` | `./assets/audio` | Destino de WAV generados |

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `GET` | `/api/generate/health` | Estado de ComfyUI + TTS |
| `POST` | `/api/generate/audio` | Genera narración WAV vía Qwen3-TTS |
| `POST` | `/api/generate/video` | Genera video/imagen vía ComfyUI |

## Manejo de Errores

| Código HTTP | Error code | Causa |
|---|---|---|
| 503 | `COMFYUI_OFFLINE` | ComfyUI no está en ejecución |
| 507 | `COMFYUI_OOM` | GPU sin VRAM disponible |
| 504 | `COMFYUI_TIMEOUT` | Render superó el timeout |
| 503 | `TTS_OFFLINE` | Servidor Qwen TTS no disponible |
