import { AudioResult, VoiceOptions } from '../../types/job.types';

export interface IAudioService {
  providerName: string;
  generateSpeech(text: string, options: VoiceOptions): Promise<AudioResult>;
}
