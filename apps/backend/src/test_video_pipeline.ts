/**
 * IADivulger — Video Pipeline E2E Test
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Creates a job with 2 presentation slides + 1 AI video scene (Wan 2.2),
 * approves it, and waits for the full pipeline (TTS → ComfyUI → Remotion).
 *
 * Uses the TEST workflow (3 steps, 9 frames) for speed.
 *
 * Run: npx tsx apps/backend/src/test_video_pipeline.ts
 */

import fs from 'fs';
import path from 'path';
import './config';

const BASE = 'http://localhost:3001/api';
const AI_WORKER = 'http://localhost:8000';
const COMFYUI = 'http://localhost:8189';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function post(path: string, body: any) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`POST ${path} → ${r.status}: ${err}`);
  }
  return r.json();
}

async function get(path: string) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function put(path: string, body: any) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PUT ${path} → ${r.status}`);
  return r.json();
}

function section(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

// ─── Pre-flight checks ───────────────────────────────────────────────────────

async function checkServices() {
  section('🔍 Pre-flight service checks');

  // Backend
  try {
    const r = await fetch(`${BASE}/health`);
    if (r.ok) console.log('  ✅ Backend online (port 3001)');
    else throw new Error(`HTTP ${r.status}`);
  } catch {
    console.log('  ❌ Backend OFFLINE — Start: npm run dev (in apps/backend)');
    process.exit(1);
  }

  // AI Worker
  try {
    const r = await fetch(`${AI_WORKER}/health`);
    if (r.ok) console.log('  ✅ AI Worker online (port 8000)');
    else throw new Error(`HTTP ${r.status}`);
  } catch {
    console.log('  ❌ AI Worker OFFLINE — Start: cd apps/ai-worker && .venv\\Scripts\\python.exe -m uvicorn main:app --port 8000');
    process.exit(1);
  }

  // ComfyUI
  try {
    const r = await fetch(`${COMFYUI}/system_stats`);
    if (r.ok) {
      const data = await r.json();
      const vramFree = data?.devices?.[0]?.vram_free;
      const vramGB = vramFree ? (vramFree / 1024 / 1024 / 1024).toFixed(1) : 'N/A';
      console.log(`  ✅ ComfyUI online (port 8189) — VRAM free: ${vramGB}GB`);
    } else throw new Error(`HTTP ${r.status}`);
  } catch {
    console.log('  ❌ ComfyUI OFFLINE — Start: cd apps/comfyui && .venv\\Scripts\\python.exe main.py --port 8189');
    process.exit(1);
  }

  // TTS (optional)
  try {
    const r = await fetch('http://localhost:9000/health');
    if (r.ok) console.log('  ✅ TTS online (port 9000)');
    else console.log('  ⚠️  TTS responded but not healthy — audio will be skipped');
  } catch {
    console.log('  ⚠️  TTS offline (port 9000) — audio will be skipped, video will still work');
  }

  // Check that AI Worker can reach ComfyUI
  try {
    const r = await fetch(`${AI_WORKER}/api/generate/health`);
    const data = await r.json();
    if (data.comfyui_online) {
      console.log('  ✅ AI Worker → ComfyUI connection OK');
    } else {
      console.log('  ❌ AI Worker CANNOT reach ComfyUI — check COMFYUI_URL in apps/ai-worker/.env');
      process.exit(1);
    }
  } catch (e: any) {
    console.log(`  ⚠️  Could not verify AI Worker → ComfyUI link: ${e.message}`);
  }
}

// ─── Main test ────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '█'.repeat(60));
  console.log('  IADivulger — VIDEO PIPELINE E2E TEST');
  console.log(`  ${new Date().toLocaleString()}`);
  console.log('█'.repeat(60));

  await checkServices();

  // ── Load the TEST workflow (3 steps, 9 frames → fast) ──────────────────────
  const testWorkflowPath = path.resolve(__dirname, 'workflows/wan_2.2_test_workflow.json');
  if (!fs.existsSync(testWorkflowPath)) {
    console.error(`\n  ❌ Test workflow not found: ${testWorkflowPath}`);
    process.exit(1);
  }
  const testWorkflow = JSON.parse(fs.readFileSync(testWorkflowPath, 'utf-8'));
  console.log(`\n  📄 Test workflow loaded: 3 steps, 9 frames (fast mode)`);

  // ── Step 1: Create a 3-scene job ───────────────────────────────────────────
  section('📝 Step 1: Create job with 2 slides + 1 AI video');

  const job = await post('/jobs', {
    projectId: `test-${Date.now()}`,
    title: 'Test Pipeline — Video IA',
    description: 'Test automático: 2 slides + 1 video generado por Wan 2.2',
    targetDuration: 20,
    formats: ['16:9'],
    language: 'es',
    script: {
      scenes: [
        {
          sceneId: 's1',
          type: 'presentation',
          narration: 'Bienvenidos al test del pipeline de IADivulger. Vamos a verificar que el sistema completo funciona correctamente.',
          durationSeconds: 5,
          voiceOptions: { speed: 1.0, language: 'es' },
          slide: {
            headline: 'IADivulger',
            bodyText: 'Test del Pipeline de Video',
            style: 'title',
            backgroundColor: '#020617',
            accentColor: '#6366f1',
          }
        },
        {
          sceneId: 's2',
          type: 'video',
          narration: 'El cosmos, infinito y misterioso.',
          durationSeconds: 5,
          visualPrompt: 'A cinematic slow zoom through a colorful nebula in deep space, stars twinkling, purple and blue gas clouds, dramatic lighting, 4k, masterpiece',
          voiceOptions: { speed: 1.0, language: 'es' },
        },
        {
          sceneId: 's3',
          type: 'presentation',
          narration: 'El pipeline está completo. Si estás viendo esto, todo funciona correctamente.',
          durationSeconds: 5,
          voiceOptions: { speed: 1.0, language: 'es' },
          slide: {
            headline: '✅ Pipeline OK',
            bulletPoints: [
              'TTS: Audio generado',
              'ComfyUI: Video generado por IA',
              'Remotion: Render completo',
            ],
            style: 'bullets',
            backgroundColor: '#0f172a',
            accentColor: '#10b981',
          }
        },
      ]
    },
    metadata: {
      createdAt: new Date().toISOString(),
      requestedBy: 'test_script',
      topic: 'Pipeline Test',
      generatedByLLM: false,
      provider: 'manual',
    }
  });

  const jobId = job.id;
  console.log(`  ✅ Job created: ${jobId}`);
  console.log(`     Scenes: 3 (slide → AI video → slide)`);

  // ── Inject the TEST workflow into the video scene ──────────────────────────
  // We need to inject the prompt and set the workflow on the video scene
  const jobData = await get(`/jobs/${jobId}`);
  const scenes = jobData.payload.script.scenes;
  const videoScene = scenes.find((s: any) => s.type === 'video');

  // Inject prompt into the test workflow
  const wf = JSON.parse(JSON.stringify(testWorkflow)); // deep clone
  if (wf['4']?.inputs?.positive_prompt) {
    wf['4'].inputs.positive_prompt = wf['4'].inputs.positive_prompt.replace(
      '[PROMPT]',
      videoScene.visualPrompt
    );
  }

  console.log(`  📋 Workflow prompt injected: "${videoScene.visualPrompt.slice(0, 60)}…"`);

  // ── Step 2: Trigger the pipeline ───────────────────────────────────────────
  section('🚀 Step 2: Approve job → trigger pipeline');

  const patchResp = await fetch(`${BASE}/jobs/${jobId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'PENDING' }),
  });
  const triggered = await patchResp.json();
  console.log(`  ✅ Pipeline triggered: ${triggered.status}`);
  console.log(`  ⏳ Pipeline will: TTS (3 scenes) → ComfyUI video (1 scene) → Remotion render`);

  // ── Step 3: Poll until complete ────────────────────────────────────────────
  section('⏳ Step 3: Waiting for pipeline completion');

  const maxWaitMs = 30 * 60 * 1000; // 30 min max
  const pollIntervalMs = 10 * 1000;
  const start = Date.now();
  let lastStatus = '';

  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    const status = await get(`/jobs/${jobId}`);
    const elapsed = Math.round((Date.now() - start) / 1000);

    if (status.status !== lastStatus) {
      console.log(`\n  📊 Status: ${status.status} | progress: ${status.progress ?? 0}% | ${elapsed}s elapsed`);
      lastStatus = status.status;
    } else {
      process.stdout.write(`\r  ⏳ ${status.status} · ${status.progress ?? 0}% · ${elapsed}s elapsed...`);
    }

    if (status.status === 'COMPLETED') {
      console.log(`\n\n${'═'.repeat(60)}`);
      console.log(`  🎉 PIPELINE COMPLETED!`);
      console.log('═'.repeat(60));
      console.log(`  Final video: ${status.finalVideoUrl}`);
      console.log(`  Total time:  ${elapsed}s`);

      // Check video accessible
      if (status.finalVideoUrl) {
        try {
          const vr = await fetch(status.finalVideoUrl, { method: 'HEAD' });
          if (vr.ok) {
            console.log(`  ✅ Video URL accessible (HTTP ${vr.status})`);
          } else {
            console.log(`  ⚠️  Video URL returned HTTP ${vr.status}`);
          }
        } catch {
          console.log(`  ⚠️  Could not reach video URL`);
        }
      }

      // Check scenes for assets
      const updatedJob = await get(`/jobs/${jobId}`);
      const updatedScenes = updatedJob.payload.script.scenes;
      for (const s of updatedScenes) {
        const icon = s.type === 'video' ? '🎬' : '📊';
        const audio = s.audioUrl ? '🔊' : '🔇';
        const video = s.assetUrl ? '✅' : (s.type === 'video' ? '❌' : '—');
        console.log(`  ${icon} ${s.sceneId}: ${audio} audio | ${video} video | ${s.durationSeconds}s`);
      }

      console.log(`\n  Open this URL in a browser to watch: ${status.finalVideoUrl}\n`);
      return;
    }

    if (status.status === 'FAILED') {
      console.log(`\n\n  ❌ PIPELINE FAILED: ${status.error || 'unknown error'}`);
      process.exit(1);
    }
  }

  console.log(`\n  ❌ TIMEOUT: Pipeline did not complete in 30 minutes`);
  process.exit(1);
}

main().catch(e => {
  console.error(`\n  🔥 FATAL: ${e.message}`);
  process.exit(1);
});
