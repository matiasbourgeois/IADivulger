import axios from 'axios';
import fs from 'fs';
import path from 'path';

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://localhost:8000';

export interface AudioGenerationResponse {
  scene_id: string;
  audio_path: string;
  provider: string;
}

export interface VideoGenerationResponse {
  scene_id: string;
  prompt_id?: string;
  asset_path: string;
  provider: string;
}

export class AiWorkerClient {
  private static instance: AiWorkerClient;
  private client = axios.create({
    baseURL: AI_WORKER_URL,
    timeout: 120000, // 2 min timeout for individual HTTP calls (NOT the whole generation)
  });

  private constructor() {}

  public static getInstance(): AiWorkerClient {
    if (!AiWorkerClient.instance) {
      AiWorkerClient.instance = new AiWorkerClient();
    }
    return AiWorkerClient.instance;
  }

  public async generateAudio(sceneId: string, text: string, voiceOptions?: any): Promise<string> {
    console.log(`[AiWorkerClient] Generating audio with Qwen3-TTS for scene: ${sceneId}`);
    const response = await this.client.post<AudioGenerationResponse>('/api/generate/audio', {
      scene_id: sceneId,
      text,
      voice_options: {
        speed: voiceOptions?.speed || 1.0,
        language: voiceOptions?.language || 'es',
        voice_id: voiceOptions?.voiceId || 'default',
        voice_description: voiceOptions?.description || "A professional, clear male voice."
      },
      output_filename_prefix: 'narration'
    });
    
    // /assets/internal/ maps to apps/ai-worker/assets/ (internal mount in main.py)
    return `${AI_WORKER_URL}/assets/internal/${response.data.audio_path}`;
  }

  private _loadWorkflow(): any {
    try {
      // USE_TEST_WORKFLOW=true → loads 9-frame/3-step test workflow (~2 min render)
      if (process.env.USE_TEST_WORKFLOW === 'true') {
        const testPath = path.resolve(__dirname, '../workflows/wan_2.2_test_workflow.json');
        if (fs.existsSync(testPath)) {
          console.log('[AiWorkerClient] TEST MODE: Loaded 9-frame/3-step test workflow');
          return JSON.parse(fs.readFileSync(testPath, 'utf-8'));
        }
      }
      const workflowPath = path.resolve(__dirname, '../workflows/wan_2.2_workflow.json');
      if (fs.existsSync(workflowPath)) {
        console.log(`[AiWorkerClient] SUCCESS: Loaded Wan 2.2 workflow (size: ${fs.statSync(workflowPath).size} bytes)`);
        return JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
      }
      const fallbackPath = path.resolve(__dirname, '../workflows/wan_2.1_workflow.json');
      if (fs.existsSync(fallbackPath)) {
        console.log(`[AiWorkerClient] FALLBACK: Loaded Wan 2.1 workflow`);
        return JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[AiWorkerClient] Failed to load workflow file:', err);
    }
    return {};
  }

  /**
   * Generate video using the NON-BLOCKING queue+poll pattern.
   *
   * - Step 1: POST /api/generate/video/queue → returns prompt_id immediately (no timeout risk)
   * - Step 2: Poll GET /api/generate/video/wait/{prompt_id} every 15s until done
   */
  public async generateVideo(sceneId: string, visualPrompt: string, workflow?: any): Promise<VideoGenerationResponse> {
    console.log(`[AiWorkerClient] Queueing video (non-blocking) for scene: ${sceneId}`);

    let realWorkflow = workflow || this._loadWorkflow();

    // Inject the visual prompt into the workflow
    if (realWorkflow?.['4']?.inputs?.positive_prompt) {
      realWorkflow['4'].inputs.positive_prompt = realWorkflow['4'].inputs.positive_prompt.replace('[PROMPT]', visualPrompt);
      console.log(`[AiWorkerClient] Injected prompt into Node 4: ${visualPrompt}`);
    }

    // Step 1: Queue the job — returns prompt_id in under 1 second
    console.log(`[AiWorkerClient] POST /api/generate/video/queue ...`);
    const queueResp = await this.client.post<{ scene_id: string; prompt_id: string; provider: string }>(
      '/api/generate/video/queue',
      {
        scene_id: sceneId,
        visual_prompt: visualPrompt,
        workflow: realWorkflow,
        output_filename_prefix: 'scene',
      }
    );
    const promptId = queueResp.data.prompt_id;
    console.log(`[AiWorkerClient] Queued. prompt_id=${promptId}. Starting poll loop...`);

    // Step 2: Poll every 15s for up to 90 minutes
    const maxWaitMs = 90 * 60 * 1000;
    const pollIntervalMs = 15 * 1000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      await new Promise<void>(res => setTimeout(res, pollIntervalMs));

      const waitResp = await this.client.get<{ status: string; prompt_id?: string; asset_path?: string }>(
        `/api/generate/video/wait/${promptId}`
      );
      const { status, asset_path } = waitResp.data;

      if (status === 'done' && asset_path) {
        console.log(`[AiWorkerClient] Video complete! asset_path=${asset_path}`);
        return {
          scene_id: sceneId,
          prompt_id: promptId,
          asset_path,
          provider: 'ComfyUI-Local',
        };
      }

      if (status === 'error') {
        throw new Error(`Video generation failed on AI Worker for prompt_id=${promptId}`);
      }

      const elapsedSec = Math.round((Date.now() - start) / 1000);
      console.log(`[AiWorkerClient] Still waiting for prompt_id=${promptId} (${elapsedSec}s elapsed)...`);
    }

    throw new Error(`Video generation timed out after 90 minutes for scene ${sceneId}`);
  }

  // Set asset URL on the scene — uses /assets/internal/ which maps to apps/ai-worker/assets/
  public buildAssetUrl(assetPath: string): string {
    return `${AI_WORKER_URL}/assets/internal/${assetPath}`;
  }

  public async getJobProgress(promptId: string): Promise<{ current_step: number; total_steps: number; percentage: number }> {
    const response = await this.client.get(`/api/generate/progress/${promptId}`);
    return response.data;
  }

  public async getActiveJobProgress(): Promise<{ current_step: number; total_steps: number; percentage: number; prompt_id?: string }> {
    const response = await this.client.get(`/api/generate/progress/active`);
    return response.data;
  }
}
