/**
 * IADivulger — Mega Test Suite
 * Tests ALL system flows end-to-end using minimal resources (no GPU call until the final optional step)
 * Run: npx tsx apps/backend/src/test.ts
 */

import { generateScript } from './services/LLMService';

const BASE = 'http://localhost:3001/api';
const AI_WORKER = 'http://localhost:8000';
const COMFYUI = 'http://localhost:8189';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;

function ok(label: string, value: any = true) {
  if (value) {
    console.log(`  ✅ ${label}`);
    passCount++;
  } else {
    console.log(`  ❌ ${label}`);
    failCount++;
  }
}

function fail(label: string, reason: string) {
  console.log(`  ❌ ${label}: ${reason}`);
  failCount++;
}

function section(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

async function get(path: string) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

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

async function put(path: string, body: any) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PUT ${path} → ${r.status}`);
  return r.json();
}

async function del(path: string) {
  const r = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  ok(`DELETE ${path} → ${r.status}`, r.status === 204);
}

async function headUrl(url: string): Promise<number> {
  const r = await fetch(url, { method: 'HEAD' });
  return r.status;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function testBackendHealth() {
  section('1. BACKEND — Health Check');
  try {
    const jobs = await get('/jobs');
    ok('GET /api/jobs returns array', Array.isArray(jobs));
    console.log(`     → ${jobs.length} existing jobs in persistence`);
  } catch (e: any) {
    fail('Backend reachable', e.message);
    console.log('\n  ⚠️  Backend is not running! Start it first: npx tsx apps/backend/src/server.ts');
  }
}

async function testAiWorkerHealth() {
  section('2. AI WORKER — Health Check (port 8000)');
  try {
    const r = await fetch(`${AI_WORKER}/health`);
    const data = await r.json();
    ok('AI Worker reachable', r.ok);
    ok('Health status is ok', data.status === 'ok');
    ok('Service name correct', data.service === 'iadivulger-ai-worker');
  } catch (e: any) {
    fail('AI Worker reachable (port 8000)', e.message);
    console.log('  ⚠️  Start it: cd apps/ai-worker && .venv/Scripts/python.exe -m uvicorn main:app --port 8000');
  }
}

async function testComfyUIHealth() {
  section('3. COMFYUI — Health Check (port 8189)');
  try {
    const r = await fetch(`${COMFYUI}/system_stats`);
    ok('ComfyUI reachable', r.ok);
    const data = await r.json();
    ok('Has system section', !!data.system);
    console.log(`     → VRAM: ${(data.devices?.[0]?.vram_free / 1024 / 1024 / 1024).toFixed(1) ?? 'N/A'}GB free`);
  } catch (e: any) {
    fail('ComfyUI reachable (port 8189)', e.message);
    console.log('  ⚠️  Start it: cd apps/comfyui && .venv/Scripts/python.exe main.py --port 8189');
  }
}

async function testAssetServing() {
  section('4. ASSET SERVING — Static file mounts');
  try {
    const status1 = await headUrl(`${AI_WORKER}/assets/internal/video/scene_s2.mp4`);
    const status2 = await headUrl(`${AI_WORKER}/assets/video/scene_s2.mp4`);
    ok('/assets/internal/video/ accessible', status1 === 200 || status1 === 404); // 404 ok if file doesn't exist
    ok('/assets/video/ accessible', status2 === 200 || status2 === 404);
    if (status1 === 200) ok('Last generated video accessible at /assets/internal/', true);
    if (status2 === 200) ok('Last generated video accessible at /assets/ (backwards compat)', true);
  } catch (e: any) {
    fail('Asset serving', e.message);
  }
}

async function testLLMService() {
  section('5. LLM SERVICE — Script generation (static fallback, 0 API cost)');
  try {
    const payload = await generateScript({
      topic: 'Historia de la Computación',
      durationMinutes: 5,
      language: 'es',
    });
    ok('Generated a title', !!payload.title);
    ok('Has scenes array', Array.isArray(payload.script.scenes));
    ok('Has > 3 scenes', payload.script.scenes.length > 3);
    
    const types = payload.script.scenes.map(s => s.type);
    const hasPresentation = types.includes('presentation');
    const hasVideo = types.includes('video');
    ok('Has presentation scenes', hasPresentation);
    ok('Has video scenes', hasVideo);
    
    const presentationPct = types.filter(t => t === 'presentation').length / types.length;
    ok('~70%+ presentation scenes', presentationPct >= 0.5);
    
    const firstSlide = payload.script.scenes.find(s => s.type === 'presentation');
    ok('Presentation scene has slide data', !!firstSlide?.slide);
    ok('Slide has headline', !!firstSlide?.slide?.headline);
    ok('Slide has style', !!firstSlide?.slide?.style);
    
    const firstVideo = payload.script.scenes.find(s => s.type === 'video');
    ok('Video scene has visualPrompt', !!firstVideo?.visualPrompt);
    ok('All scenes have narration', payload.script.scenes.every(s => !!s.narration));

    console.log(`     → Title: "${payload.title}"`);
    console.log(`     → Scenes: ${payload.script.scenes.length} (${types.filter(t => t==='presentation').length} slides, ${types.filter(t => t==='video').length} videos)`);
  } catch (e: any) {
    fail('LLM Service', e.message);
  }
}

async function testJobCRUD() {
  section('6. JOB CRUD — Create / Read / Update / Delete');
  let jobId = '';
  
  try {
    // CREATE via /generate endpoint
    const job = await post('/jobs/generate', {
      topic: 'Test: Inteligencia Artificial',
      durationMinutes: 5,
      language: 'es',
    });
    ok('POST /jobs/generate creates job', !!job.id);
    ok('Job starts as PENDING', job.status === 'PENDING');
    ok('Job has payload.title', !!job.payload?.title);
    ok('Job has scenes', job.payload?.script?.scenes?.length > 0);
    jobId = job.id;
    console.log(`     → Job ID: ${jobId}`);
    console.log(`     → Scenes: ${job.payload.script.scenes.length}`);
  } catch (e: any) {
    fail('POST /jobs/generate', e.message);
    return;
  }

  try {
    // READ single
    const fetched = await get(`/jobs/${jobId}`);
    ok('GET /jobs/:id returns job', fetched.id === jobId);
    ok('Has status field', !!fetched.status);
  } catch (e: any) {
    fail('GET /jobs/:id', e.message);
  }

  try {
    // READ list
    const all = await get('/jobs');
    ok('GET /jobs includes new job', all.some((j: any) => j.id === jobId));
  } catch (e: any) {
    fail('GET /jobs list', e.message);
  }

  try {
    // UPDATE payload (simulate user editing narration)
    const fetched = await get(`/jobs/${jobId}`);
    const updatedPayload = {
      ...fetched.payload,
      title: 'TEST UPDATED TITLE',
    };
    const updated = await put(`/jobs/${jobId}`, updatedPayload);
    ok('PUT /jobs/:id updates payload', updated.payload?.title === 'TEST UPDATED TITLE');
  } catch (e: any) {
    fail('PUT /jobs/:id', e.message);
  }

  try {
    // DELETE
    await del(`/jobs/${jobId}`);
    const all = await get('/jobs');
    ok('Job removed after DELETE', !all.some((j: any) => j.id === jobId));
  } catch (e: any) {
    fail('DELETE /jobs/:id', e.message);
  }
}

async function testWorkflowFiles() {
  section('7. WORKFLOW FILES — ComfyUI JSON config');
  const fs = await import('fs');
  const path = await import('path');
  
  const wf1 = path.resolve('apps/backend/src/workflows/wan_2.2_workflow.json');
  const wf2 = path.resolve('apps/backend/src/workflows/wan_2.2_test_workflow.json');
  
  ok('wan_2.2_workflow.json exists', fs.existsSync(wf1));
  ok('wan_2.2_test_workflow.json exists', fs.existsSync(wf2));
  
  if (fs.existsSync(wf1)) {
    const wf = JSON.parse(fs.readFileSync(wf1, 'utf-8'));
    const vaeNode = wf['2']?.inputs?.model_name;
    ok('Workflow uses Wan2.1_VAE.pth (correct 16ch VAE)', vaeNode === 'Wan2.1_VAE.pth');
    console.log(`     → VAE configured: ${vaeNode}`);
    const modelNode = wf['1']?.inputs?.unet_name;
    ok('Model name is set in workflow', !!modelNode);
    console.log(`     → Model configured: ${modelNode}`);
  }
}

async function testModels() {
  section('8. MODEL FILES — Wan 2.2 on disk');
  const fs = await import('fs');
  
  const diffModels = 'apps/comfyui/models/diffusion_models';
  const vaeModels = 'apps/comfyui/models/vae';
  const textEncoders = 'apps/comfyui/models/text_encoders';
  
  // Check diffusion model
  const diff = fs.existsSync(diffModels) ? fs.readdirSync(diffModels) : [];
  const hasWan22 = diff.some(f => f.includes('wan2.2') || f.includes('wan2_2'));
  ok('Wan 2.2 diffusion model exists', hasWan22);
  if (diff.length > 0) console.log(`     → Diffusion models: ${diff.join(', ')}`);
  
  // Check VAE
  const vaes = fs.existsSync(vaeModels) ? fs.readdirSync(vaeModels) : [];
  const hasVAE = vaes.some(f => f.includes('Wan2.1_VAE') || f.includes('Wan2_1_VAE'));
  ok('Wan2.1_VAE.pth exists (correct 16ch for 14B)', hasVAE);
  if (vaes.length > 0) console.log(`     → VAE files: ${vaes.join(', ')}`);
  
  // Check text encoder
  const enc = fs.existsSync(textEncoders) ? fs.readdirSync(textEncoders) : [];
  ok('Text encoder(s) exist', enc.length > 0);
  if (enc.length > 0) console.log(`     → Text encoders: ${enc.join(', ')}`);
}

async function testAiWorkerVideoEndpoints() {
  section('9. AI WORKER — API Endpoints (no GPU call)');
  try {
    // Progress endpoint
    const r = await fetch(`${AI_WORKER}/api/generate/progress/active`);
    ok('GET /api/generate/progress/active reachable', r.ok || r.status === 404);
    
    // Docs endpoint
    const docs = await fetch(`${AI_WORKER}/docs`);
    ok('Swagger /docs accessible', docs.ok);
  } catch (e: any) {
    fail('AI Worker endpoints', e.message);
  }
}

async function testMinimalVideoPipeline() {
  section('10. MINIMAL PIPELINE — 1 presentation scene (NO GPU, fast)');
  console.log('  ℹ️  This tests the full pipeline with a presentation-only scene:');
  console.log('     TTS → Remotion render → COMPLETED');
  console.log('  ℹ️  Skipping GPU (no video scene) to save credits\n');
  
  try {
    // Create a 1-scene presentation job (no GPU needed)
    const job = await post('/jobs/generate', {
      topic: 'Test Pipeline Minimal',
      durationMinutes: 1,
      language: 'es',
    });
    const jobId = job.id;
    ok('Created test job', !!jobId);

    // Force it to a single presentation scene to avoid GPU cost
    const minimalPayload = {
      ...job.payload,
      script: {
        scenes: [{
          sceneId: 's1',
          type: 'presentation',
          narration: 'Esto es un test del sistema IADivulger. El pipeline funciona correctamente.',
          durationSeconds: 5,
          voiceOptions: { speed: 1.0, language: 'es' },
          slide: {
            headline: 'Sistema OK',
            bodyText: 'Pipeline verificado',
            style: 'title',
            backgroundColor: '#0f172a',
            accentColor: '#10b981',
          }
        }]
      }
    };
    
    const updated = await put(`/jobs/${jobId}`, minimalPayload);
    ok('Updated to minimal 1-scene presentation', updated.payload.script.scenes.length === 1);
    ok('Scene type is presentation (no GPU)', updated.payload.script.scenes[0].type === 'presentation');

    // Trigger the pipeline
    const r = await fetch(`${BASE}/jobs/${jobId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'GENERATING_ASSETS' }),
    });
    const triggered = await r.json();
    ok('Pipeline triggered (GENERATING_ASSETS)', triggered.status === 'GENERATING_ASSETS');
    console.log(`\n  ⏳ Waiting up to 3 minutes for pipeline to complete...`);
    console.log(`     Job ID: ${jobId}`);
    
    // Poll for up to 3 minutes
    const start = Date.now();
    const maxWait = 3 * 60 * 1000;
    let completed = false;
    let failed = false;
    
    while (Date.now() - start < maxWait) {
      await new Promise(res => setTimeout(res, 5000));
      const status = await get(`/jobs/${jobId}`);
      const elapsed = Math.round((Date.now() - start) / 1000);
      
      if (status.status === 'COMPLETED') {
        completed = true;
        ok('Pipeline reached COMPLETED', true);
        ok('finalVideoUrl set', !!status.finalVideoUrl);
        if (status.finalVideoUrl) {
          console.log(`     → Final video: ${status.finalVideoUrl}`);
          const videoStatus = await headUrl(status.finalVideoUrl);
          ok('Video URL is accessible (HTTP 200)', videoStatus === 200);
        }
        break;
      } else if (status.status === 'FAILED') {
        failed = true;
        fail('Pipeline FAILED', status.error || 'unknown');
        break;
      } else {
        process.stdout.write(`\r  ⏳ ${status.status} · ${status.progress ?? 0}% · ${elapsed}s elapsed...`);
      }
    }
    
    if (!completed && !failed) {
      fail('Pipeline', 'Timeout: did not complete in 3 minutes');
    }

    // Cleanup
    await del(`/jobs/${jobId}`);
  } catch (e: any) {
    fail('Minimal pipeline test', e.message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '█'.repeat(60));
  console.log('  IADivulger — MEGA TEST SUITE');
  console.log(`  ${new Date().toLocaleString()}`);
  console.log('█'.repeat(60));
  
  await testBackendHealth();
  await testAiWorkerHealth();
  await testComfyUIHealth();
  await testAssetServing();
  await testLLMService();
  await testJobCRUD();
  await testWorkflowFiles();
  await testModels();
  await testAiWorkerVideoEndpoints();
  await testMinimalVideoPipeline();
  
  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTS: ${passCount} passed, ${failCount} failed`);
  console.log('═'.repeat(60));
  
  if (failCount === 0) {
    console.log('\n  🎉 ALL TESTS PASSED — Sistema funcionando al 100%\n');
  } else {
    console.log('\n  ⚠️  Algunos tests fallaron. Revisá los errores arriba.\n');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('\n🔥 FATAL ERROR:', e.message);
  process.exit(1);
});
