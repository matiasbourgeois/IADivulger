import dotenv from 'dotenv';
import path from 'path';

// Try multiple .env locations in order (monorepo root first, then local)
const envPaths = [
  path.resolve(process.cwd(), '.env'),                       // run from project root
  path.resolve(__dirname, '../../../../.env'),               // monorepo root relative to source
  path.resolve(__dirname, '../../../.env'),                  // apps/backend root
];

let loaded = false;
for (const p of envPaths) {
  const result = dotenv.config({ path: p });
  if (!result.error) {
    console.log(`[Config] Loaded .env from: ${p}`);
    loaded = true;
    break;
  }
}
if (!loaded) console.warn('[Config] No .env file found, using process environment only');

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  audioProvider: process.env.AUDIO_PROVIDER || 'local',
  localTtsUrl: process.env.LOCAL_TTS_URL || 'http://localhost:8188/api/prompt',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  aiWorkerUrl: process.env.AI_WORKER_URL || 'http://localhost:8000',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
};

