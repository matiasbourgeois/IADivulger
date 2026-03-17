import { ProjectPayload, Scene, SceneType, SlideStyle } from '../types/job.types';
import { v4 as uuidv4 } from 'uuid';

import '../config';  // ensure dotenv runs before we read env vars

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';


// ─── Types ───────────────────────────────────────────────────────────────────
interface GenerateOptions {
  topic: string;
  durationMinutes: number;
  language: 'es' | 'en';
  requestedBy?: string;
}

interface LLMScene {
  type: 'presentation' | 'video';
  narration: string;
  durationSeconds: number;
  visualPrompt?: string;
  slide?: {
    headline: string;
    bodyText?: string;
    bulletPoints?: string[];
    statValue?: string;
    statLabel?: string;
    style: SlideStyle;
    backgroundColor?: string;
    accentColor?: string;
  };
}

interface LLMScriptResponse {
  title: string;
  description: string;
  scenes: LLMScene[];
}

// ─── LLM Prompt ──────────────────────────────────────────────────────────────

function buildPrompt(opts: GenerateOptions): string {
  const { topic, durationMinutes, language } = opts;
  const targetScenes = Math.round(durationMinutes * 1.3); // ~1.3 scenes per minute
  const videoScenes = Math.max(2, Math.round(targetScenes * 0.3)); // 30% video
  const presentationScenes = targetScenes - videoScenes; // 70% presentations
  
  const langInstr = language === 'es'
    ? 'Genera TODO el contenido en ESPAÑOL. Las narraciones deben ser naturales y enganchadoras.'
    : 'Generate ALL content in ENGLISH. Make narrations natural and engaging.';

  return `You are a world-class documentary scriptwriter and video director. 
${langInstr}

Create a detailed script for a ${durationMinutes}-minute explainer video about: "${topic}"

The script has exactly ${targetScenes} scenes:
- ${presentationScenes} scenes of type "presentation" (animated slides with text/data)
- ${videoScenes} scenes of type "video" (AI-generated cinematic visuals)

SCENE TYPES:
- "presentation": Uses animated slides. Needs "slide" object. DO NOT set visualPrompt.
- "video": Full-screen AI video. Needs "visualPrompt" (detailed, cinematic, for Wan 2.2 AI). DO NOT set slide.

SLIDE STYLES (choose the best for each):
- "title": Opening or chapter title with big text
- "chapter": Section divider with number + label
- "bullets": Key points list (3-5 items)
- "quote": A powerful quote or statement
- "stats": A big number stat with context
- "transition": Closing or mid-video transition

SCENE TIMING:
- presentation scenes: 30-50 seconds each
- video scenes: 6-10 seconds each (short but impactful)
- Total should add up to approximately ${durationMinutes * 60} seconds

Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "string",
  "description": "string (2-3 sentences about the video)",
  "scenes": [
    {
      "type": "presentation",
      "narration": "string (what the voice says, 50-150 words)",
      "durationSeconds": 40,
      "slide": {
        "headline": "string",
        "bodyText": "string (optional)",
        "bulletPoints": ["point 1", "point 2", "point 3"],
        "style": "bullets",
        "backgroundColor": "#0f172a",
        "accentColor": "#3b82f6"
      }
    },
    {
      "type": "video",
      "narration": "string (short, punchy, 20-40 words)",
      "durationSeconds": 8,
      "visualPrompt": "Cinematic close-up of... [detailed AI video prompt]"
    }
  ]
}`;
}

// ─── Gemini Call ─────────────────────────────────────────────────────────────

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

// ─── Static Fallback (for development without API key) ───────────────────────

function buildFallbackScript(opts: GenerateOptions): LLMScriptResponse {
  const { topic, language } = opts;
  const isEs = language === 'es';
  
  return {
    title: isEs ? `La Historia de ${topic}` : `The History of ${topic}`,
    description: isEs
      ? `Un recorrido fascinante por ${topic}, explorando sus orígenes, evolución y futuro.`
      : `A fascinating journey through ${topic}, exploring its origins, evolution and future.`,
    scenes: [
      {
        type: 'presentation',
        narration: isEs
          ? `Bienvenidos a este video sobre ${topic}. Hoy vamos a explorar uno de los temas más fascinantes de nuestra era. Prepárate para un viaje que cambiará la forma en que ves el mundo.`
          : `Welcome to this video about ${topic}. Today we'll explore one of the most fascinating topics of our era.`,
        durationSeconds: 35,
        slide: { headline: isEs ? `La Historia de\n${topic}` : `The History of\n${topic}`, style: 'title', backgroundColor: '#020617', accentColor: '#6366f1' }
      },
      {
        type: 'video',
        narration: isEs ? `Los orígenes de todo empiezan con una idea.` : `Every great story begins with a single idea.`,
        durationSeconds: 8,
        visualPrompt: `Cinematic establishing shot, dramatic lighting, symbolizing the beginning of ${topic}, ultra-detailed, 8K, professional cinematography`
      },
      {
        type: 'presentation',
        narration: isEs
          ? `Para entender dónde estamos hoy, necesitamos remontarnos al principio. Los primeros pasos fueron modestos, pero sentaron las bases de todo lo que vendría después.`
          : `To understand where we are today, we need to go back to the beginning. The first steps were modest, but they laid the foundation for everything that followed.`,
        durationSeconds: 42,
        slide: { headline: isEs ? 'Los Orígenes' : 'The Origins', bulletPoints: isEs ? ['Primera etapa', 'Descubrimientos clave', 'Los pioneros', 'El momento decisivo'] : ['Early stage', 'Key discoveries', 'The pioneers', 'The pivotal moment'], style: 'bullets', backgroundColor: '#0f172a', accentColor: '#3b82f6' }
      },
      {
        type: 'presentation',
        narration: isEs ? `Los números hablan por sí solos.` : `The numbers speak for themselves.`,
        durationSeconds: 30,
        slide: { headline: isEs ? '+10 Años de Evolución' : '+10 Years of Evolution', statValue: '10x', statLabel: isEs ? 'Crecimiento en la última década' : 'Growth in the last decade', style: 'stats', backgroundColor: '#1e1b4b', accentColor: '#a855f7' }
      },
      {
        type: 'video',
        narration: isEs ? `La transformación fue imparable.` : `The transformation was unstoppable.`,
        durationSeconds: 7,
        visualPrompt: `Dramatic time-lapse visualization of rapid transformation and growth, professional cinema quality, dark moody aesthetic, neon highlights`
      },
      {
        type: 'presentation',
        narration: isEs
          ? `Hoy, ${topic} es parte de nuestras vidas de formas que nunca imaginamos. Está en nuestros teléfonos, en nuestras ciudades, en nuestra forma de trabajar y de relacionarnos.`
          : `Today, ${topic} is part of our lives in ways we never imagined. It's in our phones, our cities, our work.`,
        durationSeconds: 38,
        slide: { headline: isEs ? 'El Presente' : 'The Present', bodyText: isEs ? `${topic} ha transformado completamente la sociedad moderna.` : `${topic} has completely transformed modern society.`, bulletPoints: isEs ? ['Impacto económico global', 'Cambio en comportamiento humano', 'Nuevas industrias emergentes'] : ['Global economic impact', 'Changed human behavior', 'New emerging industries'], style: 'bullets', backgroundColor: '#042f2e', accentColor: '#10b981' }
      },
      {
        type: 'presentation',
        narration: isEs ? `¿Y el futuro? Solo estamos viendo el comienzo.` : `And the future? We're only seeing the beginning.`,
        durationSeconds: 32,
        slide: { headline: isEs ? `"El futuro ya está aquí,\nsolo que no está distribuido uniformemente."` : `"The future is already here,\nit's just not evenly distributed."`, bodyText: '— William Gibson', style: 'quote', backgroundColor: '#1c0533', accentColor: '#ec4899' }
      },
      {
        type: 'video',
        narration: isEs ? `El futuro nos espera. La pregunta es: ¿estás listo?` : `The future is waiting. The question is: are you ready?`,
        durationSeconds: 9,
        visualPrompt: `Futuristic utopian cityscape, golden hour lighting, technology and nature coexisting, cinematic aerial shot, incredibly detailed, masterpiece quality`
      },
      {
        type: 'presentation',
        narration: isEs
          ? `Gracias por acompañarnos en este recorrido. Si te gustó este video, suscríbete y activa las notificaciones para no perderte ningún episodio.`
          : `Thank you for joining us on this journey. If you enjoyed this video, subscribe and hit the bell for more content.`,
        durationSeconds: 28,
        slide: { headline: isEs ? '¿Te gustó?\nSuscríbete' : 'Enjoyed it?\nSubscribe', style: 'transition', backgroundColor: '#020617', accentColor: '#6366f1' }
      }
    ]
  };
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function generateScript(opts: GenerateOptions): Promise<ProjectPayload> {
  const projectId = uuidv4();
  let scriptData: LLMScriptResponse;

  // Read dynamically so dotenv has already run
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
  if (GEMINI_API_KEY) {
    try {
      console.log(`[LLMService] Calling Gemini Flash for topic: "${opts.topic}"`);
      const raw = await callGemini(buildPrompt(opts), GEMINI_API_KEY);
      // Strip markdown fence if present
      const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      scriptData = JSON.parse(cleaned) as LLMScriptResponse;
      console.log(`[LLMService] Gemini generated ${scriptData.scenes.length} scenes`);
    } catch (err: any) {
      console.warn(`[LLMService] Gemini failed (${err.message}), using fallback static script`);
      scriptData = buildFallbackScript(opts);
    }
  } else {
    console.log('[LLMService] No GEMINI_API_KEY set — using static fallback script');
    scriptData = buildFallbackScript(opts);
  }

  // Map to our internal Scene type
  const scenes: Scene[] = scriptData.scenes.map((s, idx) => ({
    sceneId: `s${idx + 1}`,
    type: s.type as SceneType,
    narration: s.narration,
    durationSeconds: s.durationSeconds,
    visualPrompt: s.visualPrompt,
    slide: s.slide,
    voiceOptions: {
      speed: 1.0,
      language: opts.language,
    }
  }));

  return {
    projectId,
    title: scriptData.title,
    description: scriptData.description,
    targetDuration: opts.durationMinutes * 60,
    formats: ['16:9'],
    language: opts.language,
    script: { scenes },
    metadata: {
      createdAt: new Date().toISOString(),
      requestedBy: opts.requestedBy || 'dashboard',
      topic: opts.topic,
      generatedByLLM: !!process.env.GEMINI_API_KEY,
    }
  };
}
