import io
import time
import torch
import soundfile as sf
import os
import numpy as np
import sys
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from qwen_tts import Qwen3TTSModel
from pathlib import Path

app = FastAPI(title="IADivulger Local Qwen3-TTS Server")

# Global variables
device = "cuda" if torch.cuda.is_available() else "cpu"
tts_model = None
model_path = "c:/Users/BOURGEOIS/Desktop/IADivulger/apps/tts-server/model"

@app.on_event("startup")
async def load_model():
    global tts_model
    print(f"Loading Qwen3-TTS (1.7B CustomVoice) to {device} from {model_path}...")
    try:
        # Qwen3TTSModel.from_pretrained handles AutoConfig/AutoModel registration internally
        tts_model = Qwen3TTSModel.from_pretrained(
            model_path, 
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
            device_map=device
        )
        print("Qwen3-TTS loaded successfully!")
    except Exception as e:
        print(f"Failed to load Qwen3-TTS: {e}")

class GenerateRequest(BaseModel):
    text: str
    voice_description: str = "A professional, clear male voice."

@app.post("/generate")
async def generate(req: GenerateRequest):
    if tts_model is None:
        raise HTTPException(status_code=503, detail="Model not initialized.")

    try:
        start_time = time.time()
        
        # Run the blocking model inference in a threadpool to keep the event loop responsive
        loop = asyncio.get_event_loop()
        wavs, sampling_rate = await loop.run_in_executor(
            None, 
            lambda: tts_model.generate_custom_voice(req.text, "ryan", "spanish")
        )
        
        audio_arr = wavs[0]
        gen_time = time.time() - start_time
        print(f"Generated {len(audio_arr)/sampling_rate:.2f}s of audio in {gen_time:.2f}s")

        buffer = io.BytesIO()
        sf.write(buffer, audio_arr, sampling_rate, format='WAV')
        buffer.seek(0)

        return StreamingResponse(buffer, media_type="audio/wav")

    except Exception as e:
        print(f"Error during generation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {
        "status": "ok", 
        "device": device, 
        "model": "Qwen3-TTS-1.7B-CustomVoice", 
        "loaded": tts_model is not None
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)
