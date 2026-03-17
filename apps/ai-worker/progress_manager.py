"""
Progress Manager
~~~~~~~~~~~~~~~~
Stores real-time sampling progress for active ComfyUI jobs.
"""

from typing import Dict, Any

class ProgressManager:
    _instance = None
    _progress: Dict[str, Dict[str, Any]] = {}
    _latest_prompt_id: str | None = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ProgressManager, cls).__new__(cls)
        return cls._instance

    def update(self, prompt_id: str, current_step: int, total_steps: int):
        self._latest_prompt_id = prompt_id
        self._progress[prompt_id] = {
            "current_step": current_step,
            "total_steps": total_steps,
            "percentage": int((current_step / total_steps) * 100) if total_steps > 0 else 0
        }

    def get_latest(self) -> Dict[str, Any]:
        prompt_id = self._latest_prompt_id
        if not prompt_id:
            return {"current_step": 0, "total_steps": 0, "percentage": 0, "prompt_id": None}
        
        data = self._progress.get(prompt_id, {"current_step": 0, "total_steps": 0, "percentage": 0}).copy()
        data["prompt_id"] = prompt_id
        return data

    def get(self, prompt_id: str) -> Dict[str, Any]:
        return self._progress.get(prompt_id, {"current_step": 0, "total_steps": 0, "percentage": 0})

    def clear(self, prompt_id: str):
        self._progress.pop(prompt_id, None)
        if self._latest_prompt_id == prompt_id:
            self._latest_prompt_id = None

progress_manager = ProgressManager()
