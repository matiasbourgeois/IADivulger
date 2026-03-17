"""
FastAPI Router — /api/generate
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Exposes two core endpoints consumed by the Backend Orchestrator:

  POST /api/generate/audio  → uses QwenTTSClient
  POST /api/generate/video  → uses ComfyUIClient

Both endpoints are fully async and return the local file path of the
generated asset so the orchestrator can track it or forward it.
"""

from pathlib import Path
from fastapi import APIRouter, HTTPException, status
from loguru import logger

from clients.comfyui_client import (
    ComfyUIClient,
    ComfyUIError,
    ComfyUIOfflineError,
    ComfyUIOutOfMemoryError,
    ComfyUITimeoutError,
)
from clients.qwen_tts_client import QwenTTSClient, QwenTTSError, QwenTTSOfflineError
from config import get_settings
from progress_manager import progress_manager
from schemas import (
    AudioGenerateRequest,
    AudioGenerateResponse,
    VideoGenerateRequest,
    VideoGenerateResponse,
    VideoQueueResponse,
    HealthResponse,
    ProgressResponse,
)

router = APIRouter(prefix="/api/generate", tags=["generate"])
settings = get_settings()


@router.get(
    "/progress/{prompt_id}",
    response_model=ProgressResponse,
    summary="Get real-time sampling progress for a ComfyUI prompt",
)
async def get_progress(prompt_id: str):
    """Return the latest sampling steps from the ProgressManager."""
    data = progress_manager.get(prompt_id)
    return ProgressResponse(**data)


@router.get(
    "/progress/active",
    response_model=ProgressResponse,
    summary="Get real-time sampling progress for the currently active prompt",
)
async def get_active_progress():
    """Return the latest sampling steps from the ProgressManager (latest active)."""
    data = progress_manager.get_latest()
    return ProgressResponse(**data)


# ─── Health ──────────────────────────────────────────────────────────────────

@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Check connectivity to local AI services",
)
async def health_check():
    """Ping ComfyUI and Qwen TTS to report their live status."""
    comfyui_online = False
    tts_online = False

    async with ComfyUIClient() as comfy:
        comfyui_online = await comfy.health_check()

    async with QwenTTSClient() as tts:
        tts_online = await tts.health_check()

    overall = "ok" if (comfyui_online and tts_online) else "degraded"
    return HealthResponse(status=overall, comfyui_online=comfyui_online, tts_online=tts_online)


# ─── Audio Generation ────────────────────────────────────────────────────────

import asyncio

@router.post(
    "/audio",
    response_model=AudioGenerateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate narration audio for a scene via Qwen3-TTS",
)
async def generate_audio(req: AudioGenerateRequest):
    """
    Synthesizes speech for the given text using the local Qwen3-TTS server.
    """
    logger.info(f"[Route /audio] scene_id={req.scene_id} | chars={len(req.text)}")

    if settings.use_mock:
        logger.warning(f"[MOCK] Simulating audio generation for {req.scene_id}")
        await asyncio.sleep(2)
        # Using a public valid mp3 for testing
        mock_url = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
        return AudioGenerateResponse(scene_id=req.scene_id, audio_path=mock_url)

    try:
        async with QwenTTSClient() as tts:
            audio_path = await tts.generate(
                text=req.text,
                speed=req.voice_options.speed,
                language=req.voice_options.language,
                voice_id=req.voice_options.voice_id,
                output_dir=settings.assets_audio_dir,
                filename_prefix=f"{req.output_filename_prefix}_{req.scene_id}",
            )
    except QwenTTSOfflineError as exc:
        logger.warning(f"[Route /audio] TTS server offline: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "TTS_OFFLINE", "message": str(exc)},
        )
    except QwenTTSError as exc:
        logger.error(f"[Route /audio] TTS generation failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "TTS_FAILED", "message": str(exc)},
        )

    # Convert to relative path from assets_base_dir
    rel_path = Path(audio_path).relative_to(settings.assets_base_dir)
    return AudioGenerateResponse(scene_id=req.scene_id, audio_path=rel_path.as_posix())


# ─── Video / Image Generation ────────────────────────────────────────────────

# In-memory store for active video generation tasks
_active_video_tasks: dict[str, asyncio.Task] = {}
_video_results: dict[str, dict] = {}  # prompt_id -> {"status": "done"|"error", "asset_path"?: str, "error"?: str}


@router.post(
    "/video/queue",
    response_model=VideoQueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Queue a video generation job in ComfyUI and return prompt_id immediately",
)
async def queue_video(req: VideoGenerateRequest):
    """
    NON-BLOCKING: Queues the ComfyUI workflow and immediately returns a prompt_id.
    The caller should poll GET /video/wait/{prompt_id} or /progress/{prompt_id} for status.
    """
    logger.info(f"[Route /video/queue] scene_id={req.scene_id} | prompt='{req.visual_prompt[:60]}…'")

    if settings.use_mock:
        import uuid as _uuid
        mock_pid = str(_uuid.uuid4())
        _video_results[mock_pid] = {"status": "done", "asset_path": "mock/scene.mp4"}
        return VideoQueueResponse(scene_id=req.scene_id, prompt_id=mock_pid)

    # Queue the prompt in ComfyUI and return prompt_id immediately
    async with ComfyUIClient() as comfy:
        await comfy._assert_online()
        prompt_id = await comfy._queue_prompt(req.workflow)
        client_id_to_listen = comfy._client_id  # <--- MUST capture this!

    logger.info(f"[Route /video/queue] Queued prompt_id={prompt_id} for scene={req.scene_id}")

    # Start a background task that waits for completion and stores result
    async def _background_wait(pid: str, cid: str, scene_id: str, out_dir: str, prefix: str):
        try:
            async with ComfyUIClient() as comfy2:
                # ComfyUI only broadcasts 'progress' events to the client_id that queued the prompt!
                comfy2._client_id = cid
                
                output_node_data = await asyncio.wait_for(
                    comfy2._wait_for_completion(pid),
                    timeout=comfy2._timeout,
                )
                asset_path = await comfy2._download_output(output_node_data, out_dir, prefix)
            rel_path = Path(str(asset_path)).relative_to(settings.assets_base_dir)
            _video_results[pid] = {"status": "done", "scene_id": scene_id, "asset_path": rel_path.as_posix()}
            logger.success(f"[BG Task] Video done for prompt_id={pid} -> {asset_path}")
        except Exception as exc:
            _video_results[pid] = {"status": "error", "error": str(exc)}
            logger.error(f"[BG Task] Video failed for prompt_id={pid}: {exc}")

    task = asyncio.create_task(
        _background_wait(
            prompt_id,
            client_id_to_listen,
            req.scene_id,
            settings.assets_video_dir,
            f"{req.output_filename_prefix}_{req.scene_id}",
        )
    )
    _active_video_tasks[prompt_id] = task

    return VideoQueueResponse(scene_id=req.scene_id, prompt_id=prompt_id)


@router.get(
    "/video/wait/{prompt_id}",
    summary="Poll until a queued video generation is complete. Returns asset_path when done.",
)
async def wait_for_video(prompt_id: str):
    """
    Polls the in-memory result store for a queued video generation.
    Returns {status: pending} while generation is running, or
    {status: done, asset_path: ...} when complete.
    This endpoint should be called with a long-polling loop from the Backend.
    """
    if prompt_id not in _video_results:
        return {"status": "pending", "prompt_id": prompt_id}
    result = _video_results[prompt_id]
    if result["status"] == "error":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "VIDEO_GENERATION_FAILED", "message": result.get("error", "Unknown error")},
        )
    return {"status": "done", "prompt_id": prompt_id, "asset_path": result.get("asset_path")}


@router.post(
    "/video",
    response_model=VideoGenerateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="[LEGACY] Generate a video and block until complete. Use /video/queue for long generations.",
)
async def generate_video(req: VideoGenerateRequest):
    """
    LEGACY BLOCKING endpoint kept for backward compat.
    For Wan 2.2 14B (40 min generation), use /video/queue + /video/wait instead.
    """
    logger.info(f"[Route /video] scene_id={req.scene_id} | prompt='{req.visual_prompt[:60]}…'")

    if settings.use_mock:
        logger.warning(f"[MOCK] Simulating video generation for {req.scene_id}")
        await asyncio.sleep(2)
        mock_url = "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&q=80&w=1920&h=1080"
        return VideoGenerateResponse(scene_id=req.scene_id, asset_path=mock_url)

    try:
        async with ComfyUIClient() as comfy:
            asset_path, prompt_id = await comfy.queue_and_wait(
                workflow=req.workflow,
                output_dir=settings.assets_video_dir,
                filename_prefix=f"{req.output_filename_prefix}_{req.scene_id}",
            )
    except ComfyUIOfflineError as exc:
        logger.warning(f"[Route /video] ComfyUI offline: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "COMFYUI_OFFLINE", "message": str(exc)},
        )
    except ComfyUIOutOfMemoryError as exc:
        logger.critical(f"[Route /video] GPU OOM: {exc}")
        raise HTTPException(
            status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
            detail={"error": "COMFYUI_OOM", "message": str(exc)},
        )
    except ComfyUITimeoutError as exc:
        logger.error(f"[Route /video] Timeout: {exc}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail={"error": "COMFYUI_TIMEOUT", "message": str(exc)},
        )
    except ComfyUIError as exc:
        logger.error(f"[Route /video] ComfyUI error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "COMFYUI_ERROR", "message": str(exc)},
        )
    except Exception as exc:
        logger.exception(f"[Route /video] Unhandled internal error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "INTERNAL_SERVER_ERROR", "message": str(exc)},
        )

    rel_path = Path(asset_path).relative_to(settings.assets_base_dir)
    return VideoGenerateResponse(scene_id=req.scene_id, prompt_id=prompt_id, asset_path=rel_path.as_posix())
