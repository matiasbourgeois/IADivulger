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
  const targetScenes = Math.round(durationMinutes * 1.3);
  const videoScenes = Math.max(2, Math.round(targetScenes * 0.3));
  const presentationScenes = targetScenes - videoScenes;
  
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

// ─── Static Fallback ─────────────────────────────────────────────────────────
// Only used when GEMINI_API_KEY is missing or rate-limited.
// All text uses the user's actual TOPIC so the content is always unique.

function buildFallbackScript(opts: GenerateOptions): LLMScriptResponse {
  const { topic, language } = opts;
  const T = topic; // shorthand
  const es = language === 'es';

  return {
    title: es ? `Todo sobre ${T}` : `Everything About ${T}`,
    description: es
      ? `Un recorrido profundo y visual por ${T}: sus fundamentos, su impacto actual y su futuro.`
      : `A deep, visual journey through ${T}: its foundations, current impact, and future potential.`,
    scenes: [
      {
        type: 'presentation',
        narration: es
          ? `Bienvenidos. Hoy vamos a explorar en profundidad todo lo que necesitás saber sobre ${T}. Un tema que está cambiando el mundo tal como lo conocemos. Quedate hasta el final porque vas a descubrir cosas que no sabías.`
          : `Welcome. Today we'll explore everything you need to know about ${T}. This topic is reshaping the world as we know it. Stay until the end — you'll discover things you didn't know.`,
        durationSeconds: 35,
        slide: {
          headline: es ? `${T}` : `${T}`,
          bodyText: es ? 'Entendiendo el futuro hoy' : 'Understanding the future today',
          style: 'title',
          backgroundColor: '#020617',
          accentColor: '#6366f1'
        }
      },
      {
        type: 'video',
        narration: es ? `Todo gran cambio comienza con una visión.` : `Every great change begins with a vision.`,
        durationSeconds: 8,
        visualPrompt: `Cinematic establishing shot representing ${T}, dramatic lighting, ultra-detailed, professional cinematography, 8K quality`
      },
      {
        type: 'presentation',
        narration: es
          ? `Para comprender ${T} hay que ir a sus raíces. Los conceptos fundamentales que lo sostienen fueron desarrollados durante décadas de investigación y experimentación. Hoy vamos a desglosarlos de forma simple.`
          : `To truly understand ${T}, we need to examine its roots. The core concepts were developed over decades of research. Let's break them down clearly.`,
        durationSeconds: 42,
        slide: {
          headline: es ? `Fundamentos de ${T}` : `Foundations of ${T}`,
          bulletPoints: es
            ? [`¿Qué es ${T}?`, 'Sus principios clave', 'Por qué importa hoy', 'Quiénes lo impulsan']
            : [`What is ${T}?`, 'Core principles', 'Why it matters now', 'Who drives it'],
          style: 'bullets',
          backgroundColor: '#0f172a',
          accentColor: '#3b82f6'
        }
      },
      {
        type: 'presentation',
        narration: es
          ? `Los números no mienten. El impacto de ${T} en la economía global es imposible de ignorar. Estas cifras representan una transformación real.`
          : `The numbers don't lie. The impact of ${T} on the global economy is impossible to ignore. These figures represent real transformation.`,
        durationSeconds: 30,
        slide: {
          headline: es ? `El Impacto de ${T}` : `The Impact of ${T}`,
          statValue: '$1T+',
          statLabel: es ? `Valor de mercado generado por ${T}` : `Market value generated by ${T}`,
          style: 'stats',
          backgroundColor: '#1e1b4b',
          accentColor: '#a855f7'
        }
      },
      {
        type: 'video',
        narration: es ? `La transformación ya está ocurriendo.` : `The transformation is already happening.`,
        durationSeconds: 7,
        visualPrompt: `Dramatic visualization of rapid global transformation driven by ${T}, cinematic quality, dark moody aesthetic, neon highlights, professional grade`
      },
      {
        type: 'presentation',
        narration: es
          ? `${T} ya está presente en nuestra vida cotidiana de formas que quizás no notamos. Desde cómo compramos hasta cómo trabajamos, su influencia es profunda y creciente.`
          : `${T} is already present in our daily lives in ways we may not notice. From how we shop to how we work, its influence is deep and growing.`,
        durationSeconds: 38,
        slide: {
          headline: es ? `${T} en el Mundo Real` : `${T} in the Real World`,
          bulletPoints: es
            ? ['Aplicaciones en industria', 'Impacto en el consumidor', 'Nuevos modelos de negocio']
            : ['Industrial applications', 'Consumer impact', 'New business models'],
          style: 'bullets',
          backgroundColor: '#042f2e',
          accentColor: '#10b981'
        }
      },
      {
        type: 'presentation',
        narration: es
          ? `¿Qué nos depara el futuro? Los expertos coinciden: apenas estamos viendo los primeros pasos de lo que ${T} puede lograr. Lo mejor todavía está por venir.`
          : `What does the future hold? Experts agree: we're only seeing the first steps of what ${T} can achieve. The best is yet to come.`,
        durationSeconds: 32,
        slide: {
          headline: es
            ? `"El potencial de ${T} apenas está siendo descubierto."`
            : `"The potential of ${T} is just beginning to be discovered."`,
          style: 'quote',
          backgroundColor: '#1c0533',
          accentColor: '#ec4899'
        }
      },
      {
        type: 'video',
        narration: es ? `El futuro ya llegó. ¿Estás listo?` : `The future is here. Are you ready?`,
        durationSeconds: 9,
        visualPrompt: `Futuristic utopian vision of the world transformed by ${T}, golden hour lighting, masterpiece quality, cinematic aerial shot, incredibly detailed`
      },
      {
        type: 'presentation',
        narration: es
          ? `Eso fue todo sobre ${T}. Esperamos que este video haya cambiado la forma en que lo ves. Suscríbete, compartí con alguien que necesite verlo, y hasta el próximo episodio.`
          : `That's a wrap on ${T}. We hope this video changed how you see it. Subscribe, share with someone who needs to see this, and see you in the next episode.`,
        durationSeconds: 28,
        slide: {
          headline: es ? '¿Te gustó?\nSuscríibete' : 'Enjoyed it?\nSubscribe',
          style: 'transition',
          backgroundColor: '#020617',
          accentColor: '#6366f1'
        }
      }
    ]
  };
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function generateScript(opts: GenerateOptions): Promise<ProjectPayload> {
  const projectId = uuidv4();
  let scriptData: LLMScriptResponse;
  let generatedByLLM = false;

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
  if (GEMINI_API_KEY) {
    try {
      console.log(`[LLMService] Calling Gemini Flash for topic: "${opts.topic}"`);
      const raw = await callGemini(buildPrompt(opts), GEMINI_API_KEY);
      const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      scriptData = JSON.parse(cleaned) as LLMScriptResponse;
      generatedByLLM = true;
      console.log(`[LLMService] ✅ Gemini generated ${scriptData.scenes.length} scenes for "${opts.topic}"`);
    } catch (err: any) {
      console.warn(`[LLMService] ⚠ Gemini failed: ${err.message}`);
      console.warn(`[LLMService] Falling back to template script for topic: "${opts.topic}"`);
      scriptData = buildFallbackScript(opts);
    }
  } else {
    console.log('[LLMService] No GEMINI_API_KEY — using template script');
    scriptData = buildFallbackScript(opts);
  }

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
      generatedByLLM,
    }
  };
}
