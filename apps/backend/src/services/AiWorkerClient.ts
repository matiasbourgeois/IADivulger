import axios from 'axios';
import fs from 'fs';
import path from 'path';

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://localhost:8000';

export interface AudioGenerationResponse {
  scene_id: string;
  audio_path: string;
  duration_ms: number;    // duración real del audio medida por Kokoro TTS
  provider: string;
}

export interface AudioResult {
  audioUrl: string;
  durationMs: number;     // en milisegundos, para actualizar scene.durationSeconds
}

export interface VideoGenerationResponse {
  scene_id: string;
  prompt_id?: string;
  asset_path: string;
  provider: string;
}

export interface ImageGenerationResponse {
  scene_id: string;
  prompt_id?: string;
  image_path: string;
  image_filename: string;
  provider: string;
}

export interface ImageResult {
  imagePath: string;       // relative path in AI Worker assets
  imageFilename: string;   // filename for ComfyUI LoadImage node
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

  public async generateAudio(sceneId: string, text: string, voiceOptions?: any): Promise<AudioResult> {
    console.log(`[AiWorkerClient] Generating audio with Kokoro TTS for scene: ${sceneId}`);
    const response = await this.client.post<AudioGenerationResponse>('/api/generate/audio', {
      scene_id: sceneId,
      text,
      voice_options: {
        speed: voiceOptions?.speed || 1.0,
        language: voiceOptions?.language || 'es',
        voice_id: voiceOptions?.voiceId || null,
      },
      output_filename_prefix: 'narration'
    });

    const audioUrl = `${AI_WORKER_URL}/assets/internal/${response.data.audio_path}`;
    const durationMs = response.data.duration_ms || 0;
    console.log(`[AiWorkerClient] Audio ready: ${audioUrl} | duration: ${(durationMs/1000).toFixed(2)}s`);
    return { audioUrl, durationMs };
  }

  private _loadWorkflow(type: 'i2v' | 't2v' | 'flux' = 't2v'): any {
    try {
      if (type === 'flux') {
        const fluxPath = path.resolve(__dirname, '../workflows/flux_2_image_workflow.json');
        if (fs.existsSync(fluxPath)) {
          console.log(`[AiWorkerClient] Loaded FLUX 2 Klein image workflow`);
          return JSON.parse(fs.readFileSync(fluxPath, 'utf-8'));
        }
        console.warn(`[AiWorkerClient] FLUX workflow not found!`);
        return {};
      }

      if (type === 'i2v') {
        const i2vPath = path.resolve(__dirname, '../workflows/wan_2.2_i2v_workflow.json');
        if (fs.existsSync(i2vPath)) {
          console.log(`[AiWorkerClient] Loaded Wan 2.2 I2V workflow`);
          return JSON.parse(fs.readFileSync(i2vPath, 'utf-8'));
        }
        console.warn(`[AiWorkerClient] I2V workflow not found, falling back to T2V`);
      }

      // Check for test workflow (fast: 3 steps, 9 frames)
      if (process.env.USE_TEST_WORKFLOW === 'true') {
        const testPath = path.resolve(__dirname, '../workflows/wan_2.2_test_workflow.json');
        if (fs.existsSync(testPath)) {
          console.log(`[AiWorkerClient] Loaded Wan 2.2 TEST workflow (3 steps, 9 frames — fast mode)`);
          return JSON.parse(fs.readFileSync(testPath, 'utf-8'));
        }
      }

      // Default: T2V (text-to-video) workflow
      const workflowPath = path.resolve(__dirname, '../workflows/wan_2.2_workflow.json');
      if (fs.existsSync(workflowPath)) {
        console.log(`[AiWorkerClient] Loaded Wan 2.2 T2V workflow`);
        return JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[AiWorkerClient] Failed to load workflow file:', err);
    }
    return {};
  }

  /**
   * Generate a photorealistic keyframe image using FLUX 2 Klein.
   * Returns the image filename that can be used with Wan 2.2 I2V's LoadImage node.
   */
  public async generateImage(sceneId: string, imagePrompt: string): Promise<ImageResult> {
    console.log(`[AiWorkerClient] Generating FLUX 2 keyframe for scene: ${sceneId}`);

    const rawWorkflow = this._loadWorkflow('flux');

    // Strip top-level keys starting with _ (metadata only, crash ComfyUI if sent)
    const workflow: any = {};
    for (const key of Object.keys(rawWorkflow)) {
      if (!key.startsWith('_')) workflow[key] = rawWorkflow[key];
    }

    // Inject prompt into Node 3 (CLIPTextEncode positive)
    if (workflow?.['3']?.inputs?.text !== undefined) {
      workflow['3'].inputs.text = imagePrompt;
      console.log(`[AiWorkerClient] Injected image prompt into FLUX Node 3: "${imagePrompt.slice(0, 80)}…"`);
    } else {
      console.warn(`[AiWorkerClient] ⚠ Could not find FLUX prompt node!`);
    }

    // Randomize seed
    if (workflow?.['10']?.inputs?.noise_seed !== undefined) {
      workflow['10'].inputs.noise_seed = Math.floor(Math.random() * 2147483647);
    }

    const response = await this.client.post<ImageGenerationResponse>('/api/generate/image', {
      scene_id: sceneId,
      visual_prompt: imagePrompt,
      workflow,
      output_filename_prefix: 'keyframe',
    }, { timeout: 300000 }); // 5 min timeout for image

    console.log(`[AiWorkerClient] ✓ FLUX keyframe ready: ${response.data.image_filename}`);
    return {
      imagePath: response.data.image_path,
      imageFilename: response.data.image_filename,
    };
  }

  /**
   * Generate video using the NON-BLOCKING queue+poll pattern.
   *
   * - Step 1: POST /api/generate/video/queue → returns prompt_id immediately (no timeout risk)
   * - Step 2: Poll GET /api/generate/video/wait/{prompt_id} every 15s until done
   */
  public async generateVideo(sceneId: string, visualPrompt: string, workflow?: any, inputImage?: string): Promise<VideoGenerationResponse> {
    console.log(`[AiWorkerClient] Queueing video (non-blocking) for scene: ${sceneId}`);

    let realWorkflow = workflow || this._loadWorkflow(inputImage ? 'i2v' : 't2v');

    // Inject visual prompt — try T2V workflow (Node 4 = WanVideoTextEncode) first
    if (realWorkflow?.['4']?.inputs?.positive_prompt !== undefined) {
      realWorkflow['4'].inputs.positive_prompt = realWorkflow['4'].inputs.positive_prompt.replace('[PROMPT]', visualPrompt);
      console.log(`[AiWorkerClient] Injected prompt into Node 4 (WanVideoTextEncode T2V): "${visualPrompt.slice(0, 80)}…"`);
    }
    // Fallback: I2V workflow (Node 9 = CLIPTextEncode)
    else if (realWorkflow?.['9']?.inputs?.text !== undefined) {
      realWorkflow['9'].inputs.text = realWorkflow['9'].inputs.text.replace('[PROMPT]', visualPrompt);
      console.log(`[AiWorkerClient] Injected prompt into Node 9 (CLIPTextEncode I2V): "${visualPrompt.slice(0, 80)}…"`);
    }
    else {
      console.warn(`[AiWorkerClient] ⚠ Could not find a prompt node to inject into! Workflow may use default placeholder.`);
    }

    // Inject start image for I2V (Node 11 = LoadImage)
    if (inputImage && realWorkflow?.['11']?.inputs !== undefined) {
      realWorkflow['11'].inputs.image = inputImage;
      console.log(`[AiWorkerClient] Injected start_image into Node 11 (LoadImage): ${inputImage}`);
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
