import { Router, Request, Response } from 'express';
import { JobManager } from '../services/JobManager';
import { JobStatus } from '../types/job.types';
import { generateScript } from '../services/LLMService';

export const jobRouter = Router();
const jobManager = JobManager.getInstance();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jobs/generate  — LLM generates script → creates job → returns it
// Body: { topic: string, durationMinutes?: number, language?: 'es'|'en' }
// ─────────────────────────────────────────────────────────────────────────────
jobRouter.post('/generate', async (req: Request, res: Response) => {
  const { topic, durationMinutes = 10, language = 'es' } = req.body;

  if (!topic || typeof topic !== 'string' || topic.trim().length < 3) {
    return res.status(400).json({ error: 'topic is required (min 3 chars)' });
  }

  try {
    console.log(`[Jobs] Generating script: topic="${topic}", duration=${durationMinutes}min, lang=${language}`);
    const payload = await generateScript({
      topic: topic.trim(),
      durationMinutes: Number(durationMinutes),
      language: language as 'es' | 'en',
      requestedBy: 'dashboard',
    });

    const job = jobManager.createJob(payload);
    console.log(`[Jobs] Created job ${job.id} with ${payload.script.scenes.length} scenes`);
    res.status(201).json(job);
  } catch (err: any) {
    console.error('[Jobs] Generate failed:', err.message);
    res.status(500).json({ error: 'Script generation failed', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jobs  — Create job directly with provided payload (advanced use)
// ─────────────────────────────────────────────────────────────────────────────
jobRouter.post('/', (req: Request, res: Response) => {
  try {
    const job = jobManager.createJob(req.body);
    res.status(201).json(job);
  } catch (error: any) {
    res.status(400).json({ error: 'Invalid payload', details: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jobs  — List all jobs
// ─────────────────────────────────────────────────────────────────────────────
jobRouter.get('/', (req: Request, res: Response) => {
  const status = req.query.status as JobStatus | undefined;
  const jobs = jobManager.getAllJobs({ status });
  res.json(jobs);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jobs/:id  — Get job by ID (with live progress sync)
// ─────────────────────────────────────────────────────────────────────────────
jobRouter.get('/:id', async (req: Request, res: Response) => {
  const job = await jobManager.getJobWithProgress(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/jobs/:id  — Update job payload (user edits the script)
// ─────────────────────────────────────────────────────────────────────────────
jobRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const updated = jobManager.updateJob(req.params.id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/jobs/:id  — Delete a job
// ─────────────────────────────────────────────────────────────────────────────
jobRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    jobManager.deleteJob(req.params.id);
    res.status(204).send();
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/jobs/:id/status  — Manually update status (triggers pipeline)
// ─────────────────────────────────────────────────────────────────────────────
jobRouter.patch('/:id/status', (req: Request, res: Response) => {
  const { status, error } = req.body;

  if (!Object.values(JobStatus).includes(status)) {
    return res.status(400).json({ error: 'Invalid status value', validValues: Object.values(JobStatus) });
  }

  try {
    const updated = jobManager.updateStatus(req.params.id, status as JobStatus, error);
    res.json(updated);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// ─── POST /jobs/:id/re-render — Re-run Remotion only (no AI cost) ─────────────
jobRouter.post('/:id/re-render', async (req, res) => {
  const job = jobManager.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  console.log(`[Jobs] Re-rendering job ${job.id} (${job.payload.title})`);
  
  // Set job to RENDERING so frontend shows live status
  jobManager.updateStatus(job.id, JobStatus.RENDERING);

  // Kick off render in background (don't await)
  (async () => {
    try {
      const { RemotionService } = await import('../services/RemotionService');
      const finalVideoUrl = await RemotionService.renderVideo(job.payload);
      const currentJob = jobManager.getJob(job.id)!;
      currentJob.finalVideoUrl = finalVideoUrl;
      currentJob.progress = 100;
      jobManager.updateStatus(job.id, JobStatus.COMPLETED);
      console.log(`[Jobs] ✅ Re-render complete: ${finalVideoUrl}`);
    } catch (err: any) {
      console.error(`[Jobs] ✗ Re-render failed:`, err.message);
      jobManager.updateStatus(job.id, JobStatus.FAILED, err.message);
    }
  })();

  res.json({ message: 'Re-render started', jobId: job.id, status: 'RENDERING' });
});

