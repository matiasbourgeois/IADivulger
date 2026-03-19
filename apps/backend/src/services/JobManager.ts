import { v4 as uuidv4 } from 'uuid';
import { Job, JobStatus, ProjectPayload } from '../types/job.types';
import { AiWorkerClient } from './AiWorkerClient';
import { RemotionService } from './RemotionService';
import { gpuQueue } from './GPUQueueManager';
import fs from 'fs';
import path from 'path';

// Ensure audio public dir exists
const AUDIO_PUBLIC_DIR = path.join(__dirname, '../../public/audio');
if (!fs.existsSync(AUDIO_PUBLIC_DIR)) fs.mkdirSync(AUDIO_PUBLIC_DIR, { recursive: true });

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://localhost:8000';

export class JobManager {
  private static instance: JobManager;
  private jobs: Map<string, Job> = new Map();
  private aiWorker = AiWorkerClient.getInstance();
  private readonly DATA_PATH = path.join(__dirname, '../../data/jobs.json');

  private constructor() {
    this.ensureDataDirectory();
    this.loadJobs();
  }

  public static getInstance(): JobManager {
    if (!JobManager.instance) {
      JobManager.instance = new JobManager();
    }
    return JobManager.instance;
  }

  private ensureDataDirectory() {
    const dir = path.dirname(this.DATA_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private loadJobs() {
    try {
      if (!fs.existsSync(this.DATA_PATH)) return;
      const jobsList: Job[] = JSON.parse(fs.readFileSync(this.DATA_PATH, 'utf-8'));
      let zombiesReset = 0;
      jobsList.forEach(job => {
        job.createdAt = new Date(job.createdAt);
        job.updatedAt = new Date(job.updatedAt);
        // Reset zombie in-progress jobs — put them back to AWAITING_REVIEW so user can re-approve
        if (job.status === JobStatus.GENERATING_ASSETS || job.status === JobStatus.RENDERING || job.status === JobStatus.QUEUED) {
          console.log(`[JobManager] Resetting zombie job ${job.id} from ${job.status} → AWAITING_REVIEW`);
          job.status = JobStatus.AWAITING_REVIEW;
          job.progress = 0;
          job.error = 'Pipeline interrupted (server restart). Re-approve to resume.';
          zombiesReset++;
        }
        this.jobs.set(job.id, job);
      });
      if (zombiesReset > 0) this.saveJobs();
      console.log(`[JobManager] Loaded ${this.jobs.size} jobs from persistence`);
    } catch (err) {
      console.error('[JobManager] Failed to load jobs:', err);
    }
  }

  private saveJobs() {
    try {
      fs.writeFileSync(this.DATA_PATH, JSON.stringify(Array.from(this.jobs.values()), null, 2));
    } catch (err) {
      console.error('[JobManager] Failed to save jobs:', err);
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  public createJob(payload: ProjectPayload, initialStatus: JobStatus = JobStatus.PENDING): Job {
    const now = new Date();
    const job: Job = {
      id: uuidv4(),
      status: initialStatus,
      payload,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    this.saveJobs();
    // Only start the pipeline immediately if created as PENDING
    if (initialStatus === JobStatus.PENDING) {
      this.updateStatus(job.id, JobStatus.GENERATING_ASSETS);
    }
    return job;
  }

  public updateJob(id: string, payload: Partial<ProjectPayload>): Job {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    job.payload = { ...job.payload, ...payload };
    job.updatedAt = new Date();
    this.jobs.set(id, job);
    this.saveJobs();
    console.log(`[JobManager] Job ${id} payload updated`);
    return job;
  }

  public deleteJob(id: string): void {
    if (!this.jobs.has(id)) throw new Error(`Job ${id} not found`);
    this.jobs.delete(id);
    this.saveJobs();
    console.log(`[JobManager] Job ${id} deleted`);
  }

  public getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  public getAllJobs(filter?: { status?: JobStatus }): Job[] {
    let all = Array.from(this.jobs.values());
    if (filter?.status) all = all.filter(j => j.status === filter.status);
    return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public async getJobWithProgress(id: string): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    if (job.status === JobStatus.GENERATING_ASSETS) {
      try {
        const activeProg = await this.aiWorker.getActiveJobProgress();
        if (activeProg.total_steps > 0) {
          const totalScenes = job.payload.script.scenes.length || 1;
          job.progress = Math.round((activeProg.current_step / activeProg.total_steps) * 100);
          job.currentStep = activeProg.current_step;
          job.totalSteps = activeProg.total_steps;
          job.estimatedRemainingSeconds = (activeProg.total_steps - activeProg.current_step) * 40;
          this.jobs.set(id, job);
        }
      } catch (_) {}
    }
    return job;
  }

  public updateStatus(id: string, status: JobStatus, error?: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    job.status = status;
    job.updatedAt = new Date();
    job.error = error;
    this.jobs.set(id, job);
    this.saveJobs();
    console.log(`[JobManager] Job ${id} status → ${status}`);

    // Start the pipeline when job is approved (PENDING → GENERATING_ASSETS or QUEUED)
    if (status === JobStatus.PENDING) {
      // Try to get GPU immediately, or queue if busy
      // The gpuQueue runner callback triggers processJob — do NOT call processJob again
      // in the GENERATING_ASSETS branch below to avoid duplicate concurrent execution.
      const startedImmediately = gpuQueue.enqueue(id, async () => {
        this.updateStatus(id, JobStatus.GENERATING_ASSETS);
        await this.processJob(id);
      });
      if (!startedImmediately) {
        return this.updateStatus(id, JobStatus.QUEUED);
      }
    }
    return job;
  }

  // ─── Preflight Health Check ──────────────────────────────────────────────

  private async preflightCheck(scenes: any[]): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    const TTS_URL = process.env.QWEN_TTS_URL || 'http://127.0.0.1:9000';
    const hasVideoScenes = scenes.some(s => s.type === 'video');

    // Check AI Worker
    try {
      const r = await fetch(`${AI_WORKER_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) errors.push(`AI Worker (${AI_WORKER_URL}) respondió ${r.status}`);
    } catch {
      errors.push(`AI Worker (${AI_WORKER_URL}) no responde — levantalo con: cd apps/ai-worker && .venv/Scripts/python -m uvicorn main:app --port 8000`);
    }

    // Check TTS
    try {
      const r = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) errors.push(`TTS (${TTS_URL}) respondió ${r.status}`);
    } catch {
      errors.push(`TTS (${TTS_URL}) no responde — el audio no se va a generar`);
    }

    // Check ComfyUI only if there are video scenes
    if (hasVideoScenes) {
      try {
        const r = await fetch('http://127.0.0.1:8189/system_stats', { signal: AbortSignal.timeout(3000) });
        if (!r.ok) errors.push(`ComfyUI (8189) respondió ${r.status}`);
      } catch {
        errors.push(`ComfyUI (8189) no responde — los videos IA no se van a generar`);
      }
    }

    if (errors.length > 0) {
      console.error(`[JobManager] ❌ Preflight FAILED:\n  - ${errors.join('\n  - ')}`);
    } else {
      console.log('[JobManager] ✅ Preflight OK: AI Worker, TTS, ComfyUI all online');
    }

    return { ok: errors.length === 0, errors };
  }

  // ─── Pipeline ────────────────────────────────────────────────────────────

  private async processJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    console.log(`[JobManager] ▶ Starting pipeline for Job ${jobId} (${job.payload.title})`);

    const scenes = job.payload.script.scenes;
    const totalScenes = scenes.length;
    const videoScenes = scenes.filter(s => s.type === 'video').length;
    console.log(`[JobManager] ${totalScenes} scenes total: ${videoScenes} video, ${totalScenes - videoScenes} presentation`);

    // ── PREFLIGHT: verify all services are online ───────────────────────────
    const preflight = await this.preflightCheck(scenes);
    if (!preflight.ok) {
      const errorMsg = `Servicios caídos:\n${preflight.errors.join('\n')}`;
      this.updateStatus(jobId, JobStatus.FAILED, errorMsg);
      // Throw to exit the runner — gpuQueue's .finally() will release the GPU lock
      throw new Error(errorMsg);
    }

    let videoScenesDone = 0;

    // ── TTS Health Check ──────────────────────────────────────────────────────
    const TTS_URL = process.env.QWEN_TTS_URL || 'http://127.0.0.1:9000';
    let ttsOnline = false;
    try {
      const ttsHealth = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(3000) });
      ttsOnline = ttsHealth.ok;
    } catch (_) {}
    if (!ttsOnline) {
      console.warn(`[JobManager] ⚠ TTS server is OFFLINE at ${TTS_URL}. Videos will have no audio.`);
      console.warn(`[JobManager] → Start it with: cd apps/tts-server && .venv\\Scripts\\python.exe -m uvicorn main:app --port 9000`);
    } else {
      console.log(`[JobManager] ✅ TTS server online at ${TTS_URL}`);
    }

    for (let i = 0; i < totalScenes; i++) {
      const scene = scenes[i];
      job.progress = Math.round((i / totalScenes) * 90); // leave 10% for Remotion
      this.jobs.set(jobId, job);

      // ── TTS Audio for ALL scene types ────────────────────────────────────
      try {
        const audioResult = await this.aiWorker.generateAudio(scene.sceneId, scene.narration, scene.voiceOptions);
        
        // Download WAV from AI Worker → save to backend/public/audio → serve at port 3001
        const filename = audioResult.audioUrl.split('/').pop()!;
        const localPath = path.join(AUDIO_PUBLIC_DIR, filename);
        const audioResp = await fetch(audioResult.audioUrl);
        if (audioResp.ok) {
          const buffer = Buffer.from(await audioResp.arrayBuffer());
          fs.writeFileSync(localPath, buffer);
          const backendPort = process.env.PORT || 3001;
          const backendAudioUrl = `http://localhost:${backendPort}/audio/${filename}`;
          scene.audioPath = backendAudioUrl;
          scene.audioUrl = backendAudioUrl;

          // ── AUDIO SYNC FIX: actualizar durationSeconds con la duración REAL del audio ──
          // Esto elimina los silencios de 20+ seg causados por duraciones mal estimadas por el LLM
          if (audioResult.durationMs > 0) {
            const realDurationSeconds = audioResult.durationMs / 1000;
            const prevDuration = scene.durationSeconds;
            // Usar la duración real + 0.3s de margen para que no se corte
            scene.durationSeconds = Math.round((realDurationSeconds + 0.3) * 10) / 10;
            if (Math.abs(scene.durationSeconds - prevDuration) > 0.5) {
              console.log(`[JobManager] ⏱ Audio sync fix scene ${scene.sceneId}: ${prevDuration}s → ${scene.durationSeconds}s (real audio: ${realDurationSeconds.toFixed(2)}s)`);
            }
          }

          console.log(`[JobManager] ✓ Audio for scene ${scene.sceneId} → ${backendAudioUrl} (${scene.durationSeconds}s)`);
        } else {
          console.warn(`[JobManager] ⚠ Could not download audio for ${scene.sceneId}: ${audioResp.status}`);
        }
      } catch (audioErr: any) {
        console.warn(`[JobManager] ⚠ Audio skipped for ${scene.sceneId}: ${audioErr.message}`);
      }


      // ── FLUX 2 → Wan 2.2 I2V — ONLY for type="video" scenes ─────────────
      if (scene.type === 'video' && scene.visualPrompt) {
        let inputImageFilename: string | undefined;

        // ━━━ Step 1: FLUX 2 keyframe image ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        console.log(`[JobManager] 🎨 Step 1/3: Generating FLUX 2 keyframe for scene ${scene.sceneId}...`);
        try {
          const imageResult = await this.aiWorker.generateImage(scene.sceneId, scene.visualPrompt);
          inputImageFilename = imageResult.imageFilename;
        } catch (imgErr: any) {
          console.error(`[JobManager] ✗ FLUX 2 image generation FAILED for ${scene.sceneId}: ${imgErr.message}`);
          // Don't silently fallback — warn clearly but continue with T2V as last resort
        }

        // ━━━ Step 2: VERIFY FLUX image was created ━━━━━━━━━━━━━━━━━━━━━━━
        if (inputImageFilename && inputImageFilename.length > 0) {
          console.log(`[JobManager] ✅ Step 2/3: FLUX keyframe VERIFIED → "${inputImageFilename}"`);
          console.log(`[JobManager]    Pipeline mode: FLUX 2 → Wan 2.2 I2V (image-to-video)`);
        } else {
          console.error(`[JobManager] ❌ Step 2/3: FLUX keyframe NOT CREATED — no image filename returned`);
          console.error(`[JobManager]    Pipeline mode: FALLBACK to Wan 2.2 T2V (text-to-video) — VIDEO QUALITY WILL BE LOWER`);
          console.error(`[JobManager]    To fix: check ComfyUI logs, verify FLUX 2 models are loaded (flux-2-klein-4b, qwen_3_4b, flux2-vae)`);
        }

        // ━━━ Step 3: Wan 2.2 Video (I2V if image exists, T2V otherwise) ━━
        const pipelineMode = inputImageFilename ? 'FLUX→I2V' : 'T2V-FALLBACK';
        console.log(`[JobManager] 🎬 Step 3/3: Wan 2.2 video [${pipelineMode}] for scene ${scene.sceneId}...`);
        try {
          const videoResp = await this.aiWorker.generateVideo(
            scene.sceneId,
            scene.visualPrompt,
            undefined,
            inputImageFilename // undefined → T2V, filename → I2V
          );
          scene.assetPath = videoResp.asset_path;
          scene.assetUrl = `${AI_WORKER_URL}/assets/${videoResp.asset_path}`;
          videoScenesDone++;

          // Final verification: check video asset exists
          if (scene.assetPath && scene.assetPath.length > 0) {
            console.log(`[JobManager] ✅ Video VERIFIED for ${scene.sceneId} → ${scene.assetPath} [${pipelineMode}] (${videoScenesDone}/${videoScenes})`);
          } else {
            console.error(`[JobManager] ❌ Video response OK but assetPath is empty for ${scene.sceneId}!`);
          }
        } catch (vidErr: any) {
          console.error(`[JobManager] ✗ Video generation FAILED for ${scene.sceneId} [${pipelineMode}]: ${vidErr.message}`);
        }
      }

      // ── FLUX 2 ONLY — for type="image" scenes (still + camera effect) ──
      if (scene.type === 'image' && scene.imagePrompt) {
        console.log(`[JobManager] 🖼 Image scene ${scene.sceneId}: FLUX only (effect: ${scene.imageEffect || 'ken_burns'})`);
        try {
          const imageResult = await this.aiWorker.generateImage(scene.sceneId, scene.imagePrompt);
          if (imageResult.imageFilename && imageResult.imageFilename.length > 0) {
            scene.assetPath = imageResult.imagePath;
            scene.assetUrl = `${AI_WORKER_URL}/assets/${imageResult.imagePath}`;
            console.log(`[JobManager] ✅ Image scene READY: ${scene.sceneId} → ${imageResult.imageFilename}`);
          } else {
            console.error(`[JobManager] ❌ Image scene: FLUX returned no filename for ${scene.sceneId}`);
          }
        } catch (imgErr: any) {
          console.error(`[JobManager] ✗ Image scene FLUX FAILED for ${scene.sceneId}: ${imgErr.message}`);
        }
      }

      this.saveJobs();
    }

    // ── Remotion Render ────────────────────────────────────────────────────
    this.updateStatus(jobId, JobStatus.RENDERING);
    let finalVideoPath: string;
    try {
      finalVideoPath = await RemotionService.renderVideo(job.payload);
      console.log(`[JobManager] ✓ Remotion render: ${finalVideoPath}`);
    } catch (renderErr: any) {
      // Fallback: use raw ComfyUI video from first video scene
      const firstVideo = scenes.find(s => s.type === 'video' && s.assetUrl);
      finalVideoPath = firstVideo?.assetUrl || '';
      console.warn(`[JobManager] ⚠ Remotion failed (${renderErr.message}), fallback: ${finalVideoPath}`);
    }

    job.finalVideoUrl = finalVideoPath;
    job.progress = 100;
    this.updateStatus(jobId, JobStatus.COMPLETED);
    console.log(`[JobManager] ✅ Job ${jobId} COMPLETED → ${finalVideoPath}`);
  }
}
