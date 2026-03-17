import { IAudioService } from './AudioService.interface';
import { LocalQwenTTSAdapter } from './LocalQwenTTSAdapter';
import { CloudElevenLabsAdapter } from './CloudElevenLabsAdapter';
import { config } from '../../config';

export class AudioServiceFactory {
  static getService(): IAudioService {
    const provider = config.audioProvider.toLowerCase();
    
    console.log(`[AudioServiceFactory] Instantiating provider: ${provider}`);
    
    switch (provider) {
      case 'local':
        return new LocalQwenTTSAdapter();
      case 'elevenlabs':
        return new CloudElevenLabsAdapter();
      default:
        console.warn(`[AudioServiceFactory] Unknown provider '${provider}', falling back to local.`);
        return new LocalQwenTTSAdapter();
    }
  }
}
