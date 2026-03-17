import { IAudioService } from './AudioService.interface';
import { AudioResult, VoiceOptions } from '../../types/job.types';
import { config } from '../../config';

export class LocalQwenTTSAdapter implements IAudioService {
  public providerName = 'LocalQwenTTS (ComfyUI)';

  async generateSpeech(text: string, options: VoiceOptions): Promise<AudioResult> {
    console.log(`[LocalQwenTTS] Requesting TTS generation via ${config.localTtsUrl}`);
    console.log(`[LocalQwenTTS] Text: "${text}" | Speed: ${options.speed}`);
    
    // Simulate HTTP request to local ComfyUI API
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          audioPath: `/storage/renders/audio/qwen_${Date.now()}.wav`,
          durationMs: text.length * 50, // simulated duration
          provider: this.providerName
        });
      }, 1000);
    });
  }
}
