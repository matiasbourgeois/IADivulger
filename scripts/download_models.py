import os
from huggingface_hub import hf_hub_download, snapshot_download
from pathlib import Path

def download_wan():
    print("🚀 Downloading Wan 2.1 models (SOTA Setup)...")
    comfy_models = Path("c:/Users/BOURGEOIS/Desktop/IADivulger/apps/comfyui/models")
    
    # 1. VAE from official Wan-AI repo (Public)
    print("  - Downloading VAE (Wan2.1_VAE.pth)...")
    hf_hub_download(
        repo_id="Wan-AI/Wan2.1-T2V-1.3B",
        filename="Wan2.1_VAE.pth",
        local_dir=comfy_models / "vae"
    )

    # 2. Text Encoder (UMT5 BF16) from official Wan-AI repo
    print("  - Downloading UMT5 Text Encoder (models_t5_umt5-xxl-enc-bf16.pth)...")
    hf_hub_download(
        repo_id="Wan-AI/Wan2.1-T2V-1.3B",
        filename="models_t5_umt5-xxl-enc-bf16.pth",
        local_dir=comfy_models / "text_encoders"
    )

    # 3. Diffusion Model (14B GGUF Q4_K_M) from city96 (Public)
    # Perfect for RTX 3090 (24GB VRAM)
    print("  - Downloading Diffusion Model (wan2.1-t2v-14b-Q4_K_M.gguf)...")
    hf_hub_download(
        repo_id="city96/Wan2.1-T2V-14B-GGUF",
        filename="wan2.1-t2v-14b-Q4_K_M.gguf",
        local_dir=comfy_models / "diffusion_models"
    )
    
    print("✅ Wan 2.1 models downloaded!")

def download_qwen():
    print("🚀 Downloading Qwen3-TTS (Strict requirement)...")
    # Qwen3-TTS-12Hz-1.7B-CustomVoice is the state-of-the-art for local custom voice generation
    snapshot_download(
        repo_id="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        local_dir="c:/Users/BOURGEOIS/Desktop/IADivulger/apps/tts-server/model"
    )
    print("✅ Qwen3-TTS models downloaded!")

if __name__ == "__main__":
    download_wan()
    download_qwen()
