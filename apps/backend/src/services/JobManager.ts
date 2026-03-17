import { v4 as uuidv4 } from 'uuid';
import { Job, JobStatus, ProjectPayload } from '../types/job.types';
import { AiWorkerClient } from './AiWorkerClient';
import { RemotionService } from './RemotionService';
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
        if (job.status === JobStatus.GENERATING_ASSETS || job.status === JobStatus.RENDERING) {
          console.log(`[JobManager] Resetting zombie job ${job.id} from ${job.status} → PENDING`);
          job.status = JobStatus.PENDING;
          job.progress = 0;
          job.error = undefined;
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

  public createJob(payload: ProjectPayload): Job {
    const now = new Date();
    const job: Job = {
      id: uuidv4(),
      status: JobStatus.PENDING,
      payload,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    this.saveJobs();
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

    if (status === JobStatus.GENERATING_ASSETS) {
      this.processJob(id).catch(err => {
        console.error(`[JobManager] Pipeline error for ${id}:`, err);
        this.updateStatus(id, JobStatus.FAILED, err.message);
      });
    }
    return job;
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

    let videoScenesDone = 0;

    for (let i = 0; i < totalScenes; i++) {
      const scene = scenes[i];
      job.progress = Math.round((i / totalScenes) * 90); // leave 10% for Remotion
      this.jobs.set(jobId, job);

      // ── TTS Audio for ALL scene types ────────────────────────────────────
      try {
        const rawAudioUrl = await this.aiWorker.generateAudio(scene.sceneId, scene.narration, scene.voiceOptions);
        // Download WAV from AI Worker → save to backend/public/audio → serve at port 3001
        // Remotion renders from the same server (localhost:3001) so this avoids cross-origin issues
        const filename = rawAudioUrl.split('/').pop()!;
        const localPath = path.join(AUDIO_PUBLIC_DIR, filename);
        const audioResp = await fetch(rawAudioUrl);
        if (audioResp.ok) {
          const buffer = Buffer.from(await audioResp.arrayBuffer());
          fs.writeFileSync(localPath, buffer);
          const backendPort = process.env.PORT || 3001;
          const backendAudioUrl = `http://localhost:${backendPort}/audio/${filename}`;
          scene.audioPath = backendAudioUrl;
          scene.audioUrl = backendAudioUrl;
          console.log(`[JobManager] ✓ Audio for scene ${scene.sceneId} → ${backendAudioUrl}`);
        } else {
          console.warn(`[JobManager] ⚠ Could not download audio for ${scene.sceneId}: ${audioResp.status}`);
        }
      } catch (audioErr: any) {
        console.warn(`[JobManager] ⚠ Audio skipped for ${scene.sceneId}: ${audioErr.message}`);
      }

      // ── Wan 2.2 Video — ONLY for type="video" scenes ─────────────────────
      if (scene.type === 'video' && scene.visualPrompt) {
        try {
          const videoResp = await this.aiWorker.generateVideo(scene.sceneId, scene.visualPrompt);
          scene.assetPath = videoResp.asset_path;
          scene.assetUrl = `${AI_WORKER_URL}/assets/${videoResp.asset_path}`;
          videoScenesDone++;
          console.log(`[JobManager] ✓ Video for scene ${scene.sceneId} (${videoScenesDone}/${videoScenes})`);
        } catch (vidErr: any) {
          console.error(`[JobManager] ✗ Video failed for ${scene.sceneId}:`, vidErr.message);
          // Don't fail the whole job — Remotion will show a placeholder
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
