import { IAudioService } from './AudioService.interface';
import { AudioResult, VoiceOptions } from '../../types/job.types';
import { config } from '../../config';

export class CloudElevenLabsAdapter implements IAudioService {
  public providerName = 'CloudElevenLabs';

  async generateSpeech(text: string, options: VoiceOptions): Promise<AudioResult> {
    console.log(`[CloudElevenLabs] Requesting TTS generation using API Key...`);
    console.log(`[CloudElevenLabs] Text: "${text}" | VoiceId: ${options.voiceId || 'default'}`);

    if (!config.elevenLabsApiKey) {
      throw new Error('ELEVENLABS_API_KEY is not defined in environment variables.');
    }

    // Simulate HTTPS request to ElevenLabs API
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          audioPath: `/storage/renders/audio/elevenlabs_${Date.now()}.mp3`,
          durationMs: text.length * 45, // simulated duration
          provider: this.providerName
        });
      }, 800);
    });
  }
}
