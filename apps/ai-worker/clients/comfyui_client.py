"""
ComfyUI Client
~~~~~~~~~~~~~~
Handles all communication with the local ComfyUI server (http + WebSocket).

Flow:
  1. POST /prompt        → queue a workflow, receive prompt_id
  2. WS /ws?client_id=X → listen for 'execution_success' or 'execution_error'
  3. GET /history        → retrieve output filenames
  4. GET /view           → download the asset bytes to disk

Error handling covers:
  - ComfyUI server offline (ConnectionRefusedError)
  - GPU Out-of-Memory (OOM) detected in error message
  - Execution timeout
  - Non-200 HTTP responses
"""

import asyncio
import json
import uuid
from pathlib import Path

import aiofiles
import httpx
import websockets
from loguru import logger

from config import get_settings
from progress_manager import progress_manager

settings = get_settings()


class ComfyUIError(Exception):
    """Raised for any error originating from the ComfyUI side."""


class ComfyUIOfflineError(ComfyUIError):
    """Raised when ComfyUI cannot be reached."""


class ComfyUIOutOfMemoryError(ComfyUIError):
    """Raised when ComfyUI reports a VRAM / OOM error."""


class ComfyUITimeoutError(ComfyUIError):
    """Raised when a job exceeds the configured timeout."""


class ComfyUIClient:
    """
    Async client for the ComfyUI REST + WebSocket API.

    Usage:
        async with ComfyUIClient() as client:
            file_path = await client.queue_and_wait(workflow_json, output_dir)
    """

    def __init__(self) -> None:
        self._base_url = settings.comfyui_url
        self._ws_url = settings.comfyui_ws_url
        self._timeout = settings.comfyui_timeout_s
        self._client_id = str(uuid.uuid4())
        self._http: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "ComfyUIClient":
        self._http = httpx.AsyncClient(base_url=self._base_url, timeout=30.0)
        return self

    async def __aexit__(self, *_) -> None:
        if self._http:
            await self._http.aclose()

    # ─── Public API ──────────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """Return True if ComfyUI is reachable."""
        try:
            resp = await self._http.get("/system_stats")
            return resp.status_code == 200
        except (httpx.ConnectError, httpx.ConnectTimeout):
            return False

    async def queue_and_wait(
        self,
        workflow: dict,
        output_dir: str,
        filename_prefix: str = "output",
    ) -> tuple[Path, str]:
        """
        Send a workflow, wait for completion via WebSocket, and download the result.

        Args:
            workflow:        ComfyUI workflow dict (API-format JSON).
            output_dir:      Directory where the output file will be saved.
            filename_prefix: Suggested prefix for the saved file.

        Returns:
            A tuple containing (Path to the downloaded file, prompt_id).

        Raises:
            ComfyUIOfflineError, ComfyUIOutOfMemoryError, ComfyUITimeoutError, ComfyUIError
        """
        await self._assert_online()

        # 1. Queue the prompt
        prompt_id = await self._queue_prompt(workflow)
        logger.info(f"[ComfyUI] Queued prompt_id={prompt_id} | client_id={self._client_id}")

        # 2. Wait for execution via WebSocket
        try:
            output_node_data = await asyncio.wait_for(
                self._wait_for_completion(prompt_id),
                timeout=self._timeout,
            )
        except asyncio.TimeoutError:
            logger.error(f"[ComfyUI] Job {prompt_id} timed out after {self._timeout}s")
            raise ComfyUITimeoutError(f"Job {prompt_id} timed out after {self._timeout}s")
        
        logger.success(f"[ComfyUI] Prompt {prompt_id} completed. Downloading output…")

        # 3. Download the output file
        asset_path = await self._download_output(output_node_data, output_dir, filename_prefix)
        return asset_path, prompt_id

    # ─── Private helpers ─────────────────────────────────────────────────────

    async def _assert_online(self) -> None:
        if not await self.health_check():
            raise ComfyUIOfflineError(
                f"ComfyUI is not reachable at {self._base_url}. "
                "Make sure it is running before submitting a job."
            )

    async def _queue_prompt(self, workflow: dict) -> str:
        """POST the workflow and return the prompt_id. Retries on HTTP 500."""
        max_attempts = 3

        # ── Sanitize workflow: strip top-level keys starting with _ ──────
        # ComfyUI's node_replace_manager iterates prompt.values() and expects
        # each value to be a dict with "class_type". Metadata keys like
        # _comment (str), _frame_length (int), _recommended_fps (int) cause
        # TypeError: argument of type 'int' is not iterable.
        clean_workflow = {
            k: v for k, v in workflow.items() if not k.startswith("_")
        }
        stripped = set(workflow.keys()) - set(clean_workflow.keys())
        if stripped:
            logger.info(f"[ComfyUI] Stripped {len(stripped)} metadata keys from workflow: {sorted(stripped)}")

        for attempt in range(1, max_attempts + 1):
            logger.info(f"[ComfyUI] Sending prompt to {self._base_url}/prompt (attempt {attempt}/{max_attempts})...")
            payload = {"prompt": clean_workflow, "client_id": self._client_id}
            try:
                resp = await self._http.post("/prompt", json=payload)
                logger.info(f"[ComfyUI] POST /prompt status: {resp.status_code}")
                
                if resp.status_code == 200:
                    data = resp.json()
                    return data["prompt_id"]
                
                # Log full response body for debugging
                body_text = resp.text[:500] if resp.text else "(empty)"
                
                if resp.status_code == 500 and attempt < max_attempts:
                    logger.warning(f"[ComfyUI] HTTP 500 (attempt {attempt}), retrying in 3s... Body: {body_text}")
                    await asyncio.sleep(3)
                    continue
                
                resp.raise_for_status()
                
            except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
                logger.error(f"[ComfyUI] Connection error: {exc}")
                raise ComfyUIOfflineError(f"Lost connection to ComfyUI while queuing prompt: {exc}")
            except httpx.TimeoutException as exc:
                logger.error(f"[ComfyUI] Timeout error: {exc}")
                raise ComfyUITimeoutError(f"ComfyUI request timed out during queuing: {exc}")
            except httpx.HTTPStatusError as exc:
                body = exc.response.text[:500] if exc.response.text else "(empty)"
                logger.error(f"[ComfyUI] HTTP error: {exc.response.status_code} - {body}")
                raise ComfyUIError(f"ComfyUI returned HTTP {exc.response.status_code}: {body}")
        
        raise ComfyUIError(f"ComfyUI returned HTTP 500 after {max_attempts} attempts")

    async def _wait_for_completion(self, prompt_id: str) -> dict:
        """
        Connect via WebSocket and listen until the prompt completes or errors.
        Also polls /history every 10s as a fallback to handle the race condition
        where the job finishes BEFORE the WebSocket connects.
        Returns the 'outputs' dict from the history for the given prompt_id.
        """
        ws_uri = f"{self._ws_url}/ws?client_id={self._client_id}"

        try:
            async with websockets.connect(ws_uri, ping_interval=20) as ws:
                # ── RACE CONDITION FIX: check if already done before listening ──
                history_data = await self._http.get(f"/history/{prompt_id}")
                if history_data.status_code == 200:
                    h = history_data.json().get(prompt_id, {})
                    if h.get("outputs"):
                        logger.info(f"[ComfyUI WS] Job {prompt_id} already in history on connect — returning immediately")
                        progress_manager.clear(prompt_id)
                        return h["outputs"]
                    msgs = h.get("status", {}).get("messages", [])
                    err = next((m for m in msgs if m[0] == "execution_error"), None)
                    if err:
                        self._raise_from_error_message(err[1].get("exception_message", "Unknown error"))

                last_history_poll = asyncio.get_event_loop().time()

                while True:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
                    except asyncio.TimeoutError:
                        # ── FALLBACK POLL: check history every 10s in case we missed events ──
                        history_data = await self._http.get(f"/history/{prompt_id}")
                        if history_data.status_code == 200:
                            h = history_data.json().get(prompt_id, {})
                            if h.get("outputs"):
                                logger.info(f"[ComfyUI] Job {prompt_id} detected via history poll — done!")
                                progress_manager.clear(prompt_id)
                                return h["outputs"]
                            msgs = h.get("status", {}).get("messages", [])
                            err = next((m for m in msgs if m[0] == "execution_error"), None)
                            if err:
                                self._raise_from_error_message(err[1].get("exception_message", "Unknown error"))
                        continue

                    # ComfyUI sends JSON text frames for status events
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        # Binary frame (preview image) — ignore
                        continue

                    msg_type = msg.get("type")
                    data = msg.get("data", {})

                    if msg_type not in ["crystools.monitor", "status"]:
                        logger.info(f"[ComfyUI WS] Received msg_type: {msg_type} (pid={prompt_id}, client_id={self._client_id})")

                    if msg_type == "progress":
                        current = data.get("value", 0)
                        total = data.get("max", 0)
                        if total > 0:
                            progress_manager.update(prompt_id, current, total)
                            logger.debug(f"[ComfyUI] Progress for {prompt_id}: {current}/{total}")

                    if msg_type == "executing" and data.get("node") is None:
                        # execution_success equivalent: no more nodes to execute
                        if data.get("prompt_id") == prompt_id:
                            progress_manager.clear(prompt_id)
                            break

                    if msg_type == "execution_error" and data.get("prompt_id") == prompt_id:
                        err_msg = data.get("exception_message", "Unknown error")
                        progress_manager.clear(prompt_id)
                        self._raise_from_error_message(err_msg)

        except (OSError, websockets.exceptions.WebSocketException) as exc:
            raise ComfyUIOfflineError(f"WebSocket connection to ComfyUI failed: {exc}")

        # Fetch history to get output file info
        return await self._fetch_output_data(prompt_id)


    async def _fetch_output_data(self, prompt_id: str) -> dict:
        """GET /history/{prompt_id} and return the outputs dict."""
        resp = await self._http.get(f"/history/{prompt_id}")
        resp.raise_for_status()
        history = resp.json()
        outputs = history.get(prompt_id, {}).get("outputs", {})
        if not outputs:
            raise ComfyUIError(f"No outputs found for prompt_id={prompt_id}")
        return outputs

    async def _download_output(
        self, outputs: dict, output_dir: str, filename_prefix: str
    ) -> Path:
        """
        Find the first file in the outputs and download it from /view endpoint.
        Works for images (.png/.jpg) and videos (.mp4/.webm).
        """
        # Extract first available file across all nodes
        file_info = None
        for _node_id, node_outputs in outputs.items():
            for key in ("videos", "images", "gifs"):
                if key in node_outputs and node_outputs[key]:
                    file_info = node_outputs[key][0]
                    break
            if file_info:
                break

        if not file_info:
            raise ComfyUIError("Could not locate a downloadable output file in ComfyUI history.")

        filename = file_info["filename"]
        subfolder = file_info.get("subfolder", "")
        filetype = file_info.get("type", "output")

        params = {"filename": filename, "subfolder": subfolder, "type": filetype}
        resp = await self._http.get("/view", params=params)
        resp.raise_for_status()

        dest_dir = Path(output_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(filename).suffix
        dest_path = dest_dir / f"{filename_prefix}{suffix}"

        async with aiofiles.open(dest_path, "wb") as f:
            await f.write(resp.content)

        logger.success(f"[ComfyUI] Asset saved → {dest_path}")
        return dest_path

    @staticmethod
    def _raise_from_error_message(message: str) -> None:
        """Parse ComfyUI error message and raise the most specific exception."""
        lower = message.lower()
        oom_keywords = ("out of memory", "cuda out of memory", "vram", "memory error")
        if any(kw in lower for kw in oom_keywords):
            raise ComfyUIOutOfMemoryError(
                f"GPU Out-of-Memory detected. Reduce resolution or batch size. "
                f"Original error: {message}"
            )
        raise ComfyUIError(f"ComfyUI execution error: {message}")
