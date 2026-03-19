import { ProjectPayload, Scene, SceneType, SlideStyle } from '../types/job.types';
import { v4 as uuidv4 } from 'uuid';
import { TavilyService } from './TavilyService';
import { WikipediaService } from './WikipediaService';
import { PexelsService } from './PexelsService';
import '../config';

// ─── API endpoints ────────────────────────────────────────────────────────────
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GEMINI_MODEL = 'gemini-3-pro-preview';    // Primary Gemini (best quality)
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-pro'; // Fallback Gemini
const GEMINI_FLASH_MODEL = 'gemini-2.5-flash';  // Flash fallback (highest free quota)

const LLM_TIMEOUT_MS = 90_000;  // 90 seconds — long prompts need time
const LLM_MAX_RETRIES = 3;      // Retries per provider before moving to next
const LLM_RETRY_DELAYS = [5000, 15000, 30000]; // Exponential backoff delays (ms)

// ─── Types ────────────────────────────────────────────────────────────────────
interface GenerateOptions {
  topic: string;
  durationMinutes: number;
  language: 'es' | 'en';
  requestedBy?: string;
  webContext?: string;
}

interface LLMScene {
  type: 'presentation' | 'video' | 'image' | 'web_image';
  narration: string;
  durationSeconds: number;
  visualPrompt?: string;
  imagePrompt?: string;
  imageEffect?: string;
  webImageUrl?: string;     // Real photo URL from Pexels/Wikipedia
  slide?: {
    headline: string;
    bodyText?: string;
    bulletPoints?: string[];
    statValue?: string;
    statLabel?: string;
    style?: string;
    backgroundColor?: string;
    accentColor?: string;
    chartData?: { labels: string[]; values: number[]; unit?: string };
  };
  sourceUrls?: string[];
}

interface LLMScriptResponse {
  title: string;
  description: string;
  scenes: LLMScene[];
}

// ─── Smart Scene Distribution ─────────────────────────────────────────────────

interface SceneDistribution {
  totalScenes: number;
  slides: number;
  videos: number;
  images: number;                // FLUX AI-generated still images
  webImages: number;             // Real photos from Pexels/Wikipedia
  avgNarrationWords: number;
  videoNarrationWords: number;
}

/**
 * Compute optimal scene distribution based on target duration.
 * Video clips are always ~7s (Wan 2.2 limit), so most content comes from narrated slides.
 * At ~2.5 words/second narration speed, we calibrate word counts to fill the time.
 */
function computeDistribution(durationMinutes: number): SceneDistribution {
  // Breakpoint table: [minutes, totalScenes, slides, videos, images, webImages, avgWords, videoWords]
  const table: [number, number, number, number, number, number, number, number][] = [
    [1,  6,  2,  1,  1,  2,  40,  15],
    [2,  10, 3,  1,  2,  4,  50,  15],
    [3,  14, 4,  1,  3,  6,  55,  15],
    [5,  20, 5,  2,  4,  9,  60,  20],
    [7,  24, 7,  2,  5,  10, 70,  20],
    [10, 30, 8,  2,  6,  14, 75,  25],
    [15, 40, 12, 2,  8,  18, 80,  25],
  ];

  // Find surrounding breakpoints for interpolation
  if (durationMinutes <= table[0][0]) {
    const [, total, slides, videos, images, webImages, avgW, vidW] = table[0];
    return { totalScenes: total, slides, videos, images, webImages, avgNarrationWords: avgW, videoNarrationWords: vidW };
  }
  if (durationMinutes >= table[table.length - 1][0]) {
    const [, total, slides, videos, images, webImages, avgW, vidW] = table[table.length - 1];
    return { totalScenes: total, slides, videos, images, webImages, avgNarrationWords: avgW, videoNarrationWords: vidW };
  }

  for (let i = 0; i < table.length - 1; i++) {
    const [minA, totalA, slidesA, videosA, imagesA, webImagesA, wA, vwA] = table[i];
    const [minB, totalB, slidesB, videosB, imagesB, webImagesB, wB, vwB] = table[i + 1];
    if (durationMinutes >= minA && durationMinutes <= minB) {
      const t = (durationMinutes - minA) / (minB - minA);
      const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
      return {
        totalScenes: lerp(totalA, totalB),
        slides: lerp(slidesA, slidesB),
        videos: lerp(videosA, videosB),
        images: lerp(imagesA, imagesB),
        webImages: lerp(webImagesA, webImagesB),
        avgNarrationWords: lerp(wA, wB),
        videoNarrationWords: lerp(vwA, vwB),
      };
    }
  }

  // Fallback
  return { totalScenes: 14, slides: 4, videos: 1, images: 3, webImages: 6, avgNarrationWords: 55, videoNarrationWords: 15 };
}

// Export for frontend preview endpoint
export { computeDistribution, SceneDistribution };

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function buildPrompt(opts: GenerateOptions): string {
  const { topic, durationMinutes, language, webContext } = opts;
  const totalSeconds = durationMinutes * 60;
  const dist = computeDistribution(durationMinutes);

  const langBlock = language === 'es'
    ? `IDIOMA: Español argentino coloquial. Tuteá al espectador ("vos", "tenés", "sabés").
TONO: Divulgador científico informal pero con autoridad. Como un amigo inteligente explicándote algo en un bar. NO como YouTuber sensacionalista.

EJEMPLOS DE APERTURAS VARIADAS (usá una DIFERENTE cada vez, NO repitas la misma en todo el guión):
- Dato directo: "En 2025, un equipo de Stanford logró algo que parecía imposible: curar un tumor cerebral con nanopartículas guiadas por IA."
- Pregunta: "¿Qué pasa cuando una inteligencia artificial procesa más datos que todos los médicos del mundo juntos?"
- Contraste: "Hace 10 años necesitabas un equipo de 50 ingenieros. Hoy, una sola persona con la herramienta correcta puede hacer lo mismo."
- Declaración directa: "Esto va a cambiar cómo entendemos la energía nuclear para siempre."
- Narrativa: "Un lunes a las 3 de la mañana, un ingeniero de DeepMind se dio cuenta de que su modelo estaba haciendo algo inesperado."
- Autoridad: "Según un estudio publicado en Nature esta semana, los resultados superaron todas las predicciones previas."

🔴 PROHIBIDO en TODAS las narraciones:
- NUNCA empieces con "Mirá", "¡Mirá!", "Mira esto"
- NUNCA uses "¿Sabías que...?" como apertura
- NUNCA uses "¡Ojo con esto!" ni "Atentos"
- NUNCA repitas la misma estructura de apertura en dos escenas consecutivas
- NUNCA uses exclamaciones excesivas (máximo 1 por escena)

🟢 CITAS Y FUENTES — REGLA CRÍTICA DE VERACIDAD:
- SOLO podés citar fuentes que aparecen en la sección "DATOS REALES DE LA WEB" de abajo.
- Si una fuente NO está en esa sección, NO la cites. NUNCA inventes nombres de medios (Infobae, La Nación, CNN, etc.) a menos que aparezcan en los datos web.
- Cuando uses datos de la sección web, citá el nombre del medio exacto que aparece ahí: "según [nombre del medio]"
- Si querés mencionar un dato general sin fuente web, usá frases genéricas: "según estudios recientes", "los expertos coinciden en", "datos disponibles indican"
- Agregá el campo "sourceUrls" SOLO con URLs que aparecen en la sección de datos web. Si no hay URL, dejá el array vacío: []
- 🔴 NUNCA inventes URLs. Es PREFERIBLE no citar fuente a inventar una falsa.`
    : `LANGUAGE: Conversational English, professional science communicator.
TONE: Smart friend explaining something over coffee. Authoritative but approachable. NOT hype YouTuber.

VARIED OPENINGS (use a DIFFERENT one each time):
- Data hook: "In 2025, a Stanford team achieved what seemed impossible..."
- Question: "What happens when an AI processes more data than every doctor on Earth combined?"
- Contrast: "Ten years ago you needed 50 engineers. Today, one person can do the same."
- Direct: "This will fundamentally change how we understand nuclear energy."
- Narrative: "At 3 AM on a Monday, a DeepMind engineer realized something unexpected."
- Authority: "According to a Nature study published this week, results exceeded all predictions."

🔴 NEVER start with "Look" or "Did you know...?"
🟢 CITE SOURCES in narration: "MIT researchers found", "a Nature paper showed"
🟢 Add "sourceUrls" field with real URLs for data used.`;

  const webSection = webContext
    ? `\n═══════════════════════════════════════════════════════════
DATOS REALES DE LA WEB (FUENTE VERIFICADA)
═══════════════════════════════════════════════════════════
${webContext}

🔴 REGLA ABSOLUTA: SOLO podés citar datos y fuentes que aparecen ARRIBA.
   NUNCA inventes fuentes, medios, o datos que no están en esta sección.
   Si necesitás más información que la que hay acá, usá frases genéricas:
   "según estudios recientes", "los expertos indican", "datos actuales sugieren"
═══════════════════════════════════════════════════════════\n`
    : `\n⚠ No se encontraron datos web verificados para este tema.
   Usá tu conocimiento general pero NUNCA cites fuentes específicas.
   Usá frases como: "según estudios recientes", "los datos disponibles indican"\n`;

  return `Sos un guionista experto de videos de YouTube con millones de vistas. Tu trabajo es crear guiones que enganchan desde el primer segundo, con CONTENIDO REAL Y ESPECÍFICO sobre el tema.

${langBlock}

TEMA DEL VIDEO: "${topic}"
DURACIÓN OBJETIVO: ${durationMinutes} minutos (~${totalSeconds} segundos total)
${webSection}

═══════════════════════════════════════════════════════════
ESTRUCTURA REQUERIDA
═══════════════════════════════════════════════════════════

Generá exactamente ${dist.totalScenes} escenas con esta distribución OBLIGATORIA:
- EXACTAMENTE ${dist.slides} escenas tipo "presentation" (slides animados con datos)
- EXACTAMENTE ${dist.videos} escena(s) tipo "video" (clips cinemáticos con movimiento IA)
- EXACTAMENTE ${dist.images} escena(s) tipo "image" (foto generada IA con efecto de cámara)
- EXACTAMENTE ${dist.webImages} escena(s) tipo "web_image" (foto REAL de Pexels con efecto de cámara)

🔴 NO generes más slides reemplazando imágenes. La distribución es OBLIGATORIA.
🔴 Cada escena debe durar MÁXIMO 20 segundos. Si una narración es larga, dividila en 2 escenas.

DURACIÓN POR ESCENA:
- Cada slide: narración de ${dist.avgNarrationWords}-${dist.avgNarrationWords + 20} palabras (~${Math.round(dist.avgNarrationWords / 2.5)}-${Math.round((dist.avgNarrationWords + 20) / 2.5)}s)
- Cada video: narración de ${dist.videoNarrationWords}-${dist.videoNarrationWords + 10} palabras (~7-10s)
- Cada imagen/web_image: narración de 30-60 palabras (~10-20s)
- TOTAL debe sumar ~${totalSeconds}s

Distribución OBLIGATORIA (seguí este orden, intercalando tipos):
1. SLIDE apertura (gancho fuerte, style "title") — MAX 15s
2. WEB_IMAGE o VIDEO — visual impactante
3-${dist.totalScenes - 1}. Alterná: SLIDE → WEB_IMAGE → SLIDE → IMAGE → WEB_IMAGE → SLIDE (nunca 2 slides seguidos)
Último: SLIDE cierre/CTA (style "transition") — MAX 12s

═══════════════════════════════════════════════════════════
REGLAS CRÍTICAS (si violás alguna, el guión es INÚTIL)
═══════════════════════════════════════════════════════════

🔴 PROHIBIDO:
- NUNCA uses el título del video como contenido de un slide. El headline de cada slide debe ser CORTO (3-6 palabras) y DISTINTO del título.
- NUNCA narraciones genéricas tipo "Hay cosas sobre X que no sabés". Cada narración debe tener DATOS CONCRETOS.
- NUNCA bullet points genéricos como "El concepto central" o "Cómo funciona". Cada bullet debe ser un DATO ESPECÍFICO.
- NUNCA duraciones de más de 15 segundos para narraciones de menos de 30 palabras.

🟢 OBLIGATORIO:
- Cada narración de slide DEBE tener entre 40-120 palabras con información REAL y ESPECÍFICA del tema.
- Cada narración de video DEBE tener 15-30 palabras, impactante y con transición.
- Los bullet points deben ser DATOS CONCRETOS (ej: "Procesa 1M tokens de contexto" en vez de "Mayor capacidad")
- Los headlines deben ser CORTOS y DESCRIPTIVOS (ej: "Ventana de Contexto" no "¿Qué es la ventana de contexto de GPT 5.4?")
- durationSeconds = ceil(cantidad_de_palabras_de_la_narración / 2.5) — calcular SIEMPRE así.

═══════════════════════════════════════════════════════════
ESTILOS DE SLIDE DISPONIBLES
═══════════════════════════════════════════════════════════

- "title": Solo para la PRIMERA escena. Headline corto + bodyText opcional.
- "bullets": Lista de 3-4 puntos CONCRETOS. Cada punto ≤10 palabras con datos reales.
- "quote": Dato impactante o frase clave entre comillas. Sin bullet points.
- "stats": Número grande + label. Usá statValue y statLabel.
- "bar_chart": Comparativa con chartData: { labels: [...], values: [...], unit: "..." }
- "transition": Solo para la ÚLTIMA escena. Cierre y CTA.

═══════════════════════════════════════════════════════════
VISUAL PROMPTS PARA ESCENAS DE VIDEO (FLUX 2 → IMAGEN FOTORREALISTA → VIDEO)
═══════════════════════════════════════════════════════════

⚠ IMPORTANTE: El visual_prompt genera una IMAGEN FOTORREALISTA con FLUX 2 que luego se anima.
NO describas movimiento. Describí UNA IMAGEN ESTÁTICA fotorrealista que capture el concepto.

FORMATO OBLIGATORIO:
"Photo of [sujeto concreto], [ángulo de cámara], [iluminación específica], [detalles del entorno], shot on Canon R5, 8K, photorealistic"

🔴 PROHIBIDO en visual_prompt:
- Nada abstracto: "glowing nodes", "neural networks", "digital patterns", "flowing data"
- Nada CGI/sci-fi: "neon", "holographic", "futuristic void", "digital particles"
- Nada genérico: "cinematic shot of AI", "technology concept", "innovation"
- Lentes/logos/marcas

🟢 OBLIGATORIO en visual_prompt:
- Sujetos REALES: personas, objetos, lugares, dispositivos, edificios
- Ángulos de cámara: "close-up", "wide angle", "aerial view", "eye-level", "over-the-shoulder"
- Iluminación real: "natural window light", "golden hour", "overcast sky", "studio lighting"
- Detalles de textura: materiales, colores, superficies

✅ BUENOS ejemplos:
- "Photo of a researcher in a white lab coat examining brain scans on dual monitors, over-the-shoulder shot, warm fluorescent office lighting, modern neuroscience lab, shot on Canon R5, 8K, photorealistic"
- "Aerial photograph of a massive Google data center campus in Oregon, rows of white buildings with cooling towers, green landscape, overcast sky, shot on drone, 8K, photorealistic"
- "Close-up photo of a person's hands typing on a MacBook Pro keyboard, screen showing code, shallow depth of field, soft natural window light, shot on Canon R5, 8K, photorealistic"
- "Wide angle photo of a packed university lecture hall with 200 students watching a AI demo on a huge projector screen, warm ambient lighting, shot on Sony A7IV, 8K, photorealistic"

❌ MALOS ejemplos (producen imágenes horribles):
- "Cinematic shot of glowing AI neural network expanding in void" ← abstracto, no fotorrealista
- "Futuristic holographic display with data streams" ← sci-fi, no existe en la realidad
- "Professional quality video about technology" ← no describe NADA visual

═══════════════════════════════════════════════════════════
COLORES
═══════════════════════════════════════════════════════════

Usá esta paleta coherente:
- backgroundColor: elegí de ["#020617", "#0f172a", "#1e1b4b", "#042f2e", "#1c0533", "#0c1a12"]
- accentColor: elegí de ["#3b82f6", "#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899", "#ef4444"]

═══════════════════════════════════════════════════════════
FORMATO DE RESPUESTA
═══════════════════════════════════════════════════════════

Respondé ÚNICAMENTE con JSON válido. Sin markdown, sin explicaciones, sin texto antes ni después.

{
  "title": "string — título atractivo para YouTube, máximo 8 palabras, SIN repetir el topic textual",
  "description": "string — 2 oraciones describiendo el contenido real del video",
  "scenes": [
    {
      "type": "presentation",
      "narration": "string — 40-120 palabras con datos reales. CITÁ fuentes: 'según investigadores de X'",
      "durationSeconds": 25,
      "sourceUrls": ["https://ejemplo.com/paper"],
      "slide": {
        "headline": "string — 3-6 palabras, corto y descriptivo",
        "bulletPoints": ["dato concreto 1", "dato concreto 2", "dato concreto 3"],
        "style": "bullets",
        "backgroundColor": "#0f172a",
        "accentColor": "#3b82f6"
      }
    },
    {
      "type": "video",
      "narration": "string — 15-30 palabras, transición impactante",
      "durationSeconds": 8,
      "sourceUrls": ["https://ejemplo.com/fuente"],
      "visualPrompt": "Photo of [SUJETO REAL Y CONCRETO], [ángulo de cámara], [iluminación], shot on Canon R5, 8K, photorealistic"
    },
    {
      "type": "image",
      "narration": "string — 40-120 palabras de contenido narrado sobre esta imagen",
      "durationSeconds": 15,
      "sourceUrls": ["https://ejemplo.com/fuente"],
      "imagePrompt": "Photo of [SUJETO REAL Y CONCRETO], [ángulo de cámara], [iluminación], shot on Canon R5, 8K, photorealistic",
      "imageEffect": "ken_burns"
    },
    {
      "type": "web_image",
      "narration": "string — 30-60 palabras narrando sobre la imagen real",
      "durationSeconds": 12,
      "sourceUrls": [],
      "webImageUrl": "https://images.pexels.com/photos/...",
      "imageEffect": "zoom_in"
    }
  ]
}

═══════════════════════════════════════════════════════════
ESCENAS TIPO "image" — REGLAS
═══════════════════════════════════════════════════════════

Las escenas "image" generan una FOTO FOTORREALISTA (con FLUX 2) y le aplican un efecto de cámara lento.
Son IDEALES para acompañar narración larga con un visual impactante sin necesidad de video animado.

- "imagePrompt" sigue las MISMAS reglas que "visualPrompt": sujetos reales, ángulos de cámara, iluminación real.
- "imageEffect" puede ser: "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "ken_burns"
  - zoom_in: ideal para revelar detalles (ej: close-up de manos, pantallas)
  - zoom_out: ideal para mostrar escala (ej: ciudades, laboratorios)

═══════════════════════════════════════════════════════════
ESCENAS TIPO "web_image" — FOTOS REALES
═══════════════════════════════════════════════════════════

Las escenas "web_image" usan FOTOS REALES descargadas de Pexels (profesionales, de alta calidad).
Son MÁS RÁPIDAS que generar con IA y dan un toque de realismo al video.

- "webImageUrl": poné la URL de la foto de Pexels de la sección FOTOS REALES DISPONIBLES.
- Si no hay fotos de Pexels disponibles, usá tipo "image" en su lugar (se genera con IA).
- "imageEffect": igual que en las escenas "image" — zoom_in, zoom_out, pan_left, pan_right, ken_burns
- Duración: 8-20 segundos
- Narración: 30-60 palabras
  - pan_left/pan_right: ideal para panoramas (ej: paisajes, multitudes)
  - ken_burns: efecto cinemático general (zoom + pan suave)
- Duración: 10-25 segundos (acompaña narración larga)
- Narración: 40-120 palabras (como un slide, pero con imagen de fondo)

⚠ REGLAS FINALES (VIOLACIÓN = GUIÓN RECHAZADO):
- "visualPrompt" es OBLIGATORIO para TODAS las escenas type "video". Sin visualPrompt, el video NO SE GENERA.
- "imagePrompt" es OBLIGATORIO para TODAS las escenas type "image". Sin imagePrompt, la imagen NO SE GENERA.
- "webImageUrl" es OBLIGATORIO para TODAS las escenas type "web_image". Usá las URLs de la sección FOTOS REALES.
- "sourceUrls" SOLO debe contener URLs de la sección "DATOS REALES DE LA WEB". Si no hay URLs verificadas, usá array vacío [].
- CADA escena DEBE empezar con una apertura DIFERENTE. VARIÁ el estilo narrativo.
- El TONO debe ser de divulgador científico: informate, con autoridad, pero cercano. NUNCA sensacionalista.
- 🔴 RESPETÁ la cantidad EXACTA de escenas de cada tipo. NO reemplaces web_image con slides.
- 🔴 Cada escena dura MÁXIMO 20 segundos. Dividí narraciones largas.
- 🔴 NUNCA inventes fuentes que no aparecen en los datos web verificados.
- 🔴 NUNCA pongas 2 slides seguidos. Alterná con imágenes entre medio.`;
}

// ─── API Callers ──────────────────────────────────────────────────────────────

async function callClaude(prompt: string, apiKey: string): Promise<string> {
  console.log(`[LLM] → Claude (${CLAUDE_MODEL})...`);
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Claude returned empty content');
  return text;
}

async function callGroq(prompt: string, apiKey: string): Promise<string> {
  console.log(`[LLM] → Groq (${GROQ_MODEL})...`);
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'You are a world-class YouTube scriptwriter. Always respond with valid JSON only, no markdown.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned empty content');
  return text;
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  console.log(`[LLM] → Gemini (${GEMINI_MODEL})...`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty content');
  return text;
}

// Gemini caller with configurable model (for fallback chain)
async function callGeminiFallback(prompt: string, apiKey: string): Promise<string> {
  const url = `${GEMINI_BASE}/${GEMINI_FALLBACK_MODEL}:generateContent?key=${apiKey}`;
  console.log(`[LLM] → Gemini Fallback (${GEMINI_FALLBACK_MODEL})...`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini Fallback ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini Fallback returned empty content');
  return text;
}

// Gemini Flash caller (highest free tier quota — 1500 RPM)
async function callGeminiFlash(prompt: string, apiKey: string): Promise<string> {
  const url = `${GEMINI_BASE}/${GEMINI_FLASH_MODEL}:generateContent?key=${apiKey}`;
  console.log(`[LLM] → Gemini Flash (${GEMINI_FLASH_MODEL})...`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini Flash ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini Flash returned empty content');
  return text;
}

// ─── Retry wrapper with exponential backoff ───────────────────────────────────

async function callWithRetry(
  fn: (prompt: string, key: string) => Promise<string>,
  prompt: string,
  key: string,
  providerName: string,
): Promise<string> {
  for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
    try {
      return await fn(prompt, key);
    } catch (err: any) {
      const isLast = attempt === LLM_MAX_RETRIES;
      const delay = LLM_RETRY_DELAYS[attempt - 1] || 30000;
      console.warn(`[LLM] ⚠ ${providerName} attempt ${attempt}/${LLM_MAX_RETRIES} failed: ${err.message}`);
      if (isLast) throw err; // Last attempt — let it propagate to next provider
      console.log(`[LLM] ⏳ Retrying ${providerName} in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`${providerName}: all ${LLM_MAX_RETRIES} retries exhausted`);
}

// ─── JSON Parser ──────────────────────────────────────────────────────────────

function parseJSON(raw: string): LLMScriptResponse {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned) as LLMScriptResponse;

  // Validate basics
  if (!parsed.title || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error('LLM response missing title or scenes');
  }

  return parsed;
}

// ─── Post-processing: fix durations, enforce quality ──────────────────────────

function postProcess(script: LLMScriptResponse): LLMScriptResponse {
  for (const scene of script.scenes) {
    // Fix duration based on actual word count (~2.5 words per second for narration)
    const wordCount = scene.narration.split(/\s+/).length;
    const calculatedDuration = Math.ceil(wordCount / 2.5);

    if (scene.type === 'video') {
      // Video scenes: min 6s, max 10s
      scene.durationSeconds = Math.max(6, Math.min(10, calculatedDuration));
    } else {
      // Presentation scenes: min 8s, max 60s
      scene.durationSeconds = Math.max(8, Math.min(60, calculatedDuration));
    }

    // Trim slide headlines that are too long (>50 chars)
    if (scene.slide?.headline && scene.slide.headline.length > 50) {
      scene.slide.headline = scene.slide.headline.substring(0, 47) + '...';
    }

    // Ensure valid slide style
    if (scene.slide) {
      const validStyles = ['title', 'bullets', 'quote', 'stats', 'bar_chart', 'transition'];
      if (!validStyles.includes(scene.slide.style || '')) {
        scene.slide.style = scene.slide.bulletPoints?.length ? 'bullets' : 'title';
      }
    }
  }

  return script;
}

// ─── Gemini Grounding Search (free web search via Google) ─────────────────────

// Only trust official / high-quality sources
const TRUSTED_DOMAINS = [
  // AI companies
  'openai.com', 'anthropic.com', 'deepmind.google', 'ai.meta.com',
  'mistral.ai', 'blog.google', 'blogs.microsoft.com', 'nvidia.com',
  'huggingface.co', 'stability.ai', 'midjourney.com',
  // Tech press
  'theverge.com', 'techcrunch.com', 'arstechnica.com', 'wired.com',
  'reuters.com', 'bloomberg.com', 'cnbc.com',
  // Academic / data
  'arxiv.org', 'nature.com', 'statista.com', 'ourworldindata.org',
  // LatAm news
  'infobae.com', 'lanacion.com.ar', 'clarin.com',
  // Wikipedia (useful for context)
  'wikipedia.org',
];

async function searchWithGeminiGrounding(topic: string, apiKey: string): Promise<string | undefined> {
  const url = `${GEMINI_BASE}/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const searchPrompt = `Buscá información verificada y actualizada sobre: "${topic}".
Respondé con un resumen de datos concretos: cifras, fechas, nombres, comparativas.
NO inventes datos. Si no encontrás algo, decí que no hay datos confirmados.
Incluí las URLs de las fuentes que uses.`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: searchPrompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 3000 },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini grounding ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) return undefined;

  // Extract grounding sources from metadata
  const groundingMeta = candidate?.groundingMetadata;
  const chunks = groundingMeta?.groundingChunks || [];
  const sources: string[] = [];

  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    if (uri) {
      // Filter: only keep trusted domains
      const isTrusted = TRUSTED_DOMAINS.some(d => uri.includes(d));
      if (isTrusted) {
        const title = chunk?.web?.title || uri;
        sources.push(`[${title}](${uri})`);
      }
    }
  }

  // Build context block for the LLM prompt
  const lines = ['═══ DATOS REALES ENCONTRADOS EN LA WEB ═══'];
  lines.push(`Búsqueda: "${topic}" | Fecha: ${new Date().toLocaleDateString('es-AR')}`);
  lines.push('');
  lines.push(text);
  lines.push('');

  if (sources.length > 0) {
    lines.push('─── FUENTES OFICIALES VERIFICADAS ───');
    sources.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
    lines.push('INSTRUCCIÓN: Usá estos datos en el guión. Incluí las URLs en el campo sourceUrls de cada escena donde cites datos de estas fuentes.');
  } else {
    lines.push('(No se encontraron fuentes oficiales verificadas. Usá datos que puedas verificar.)');
  }

  lines.push('═══════════════════════════════════════════');
  return lines.join('\n');
}

// ─── Fallback Script (last resort) ───────────────────────────────────────────

function buildFallbackScript(opts: GenerateOptions): LLMScriptResponse {
  const { topic, language } = opts;
  const es = language === 'es';

  // At least make the fallback not repeat the raw topic everywhere
  const shortTopic = topic.length > 40 ? topic.substring(0, 37) + '...' : topic;

  return {
    title: es ? `Lo Esencial de: ${shortTopic}` : `The Essential: ${shortTopic}`,
    description: es
      ? `Video generado automáticamente sobre ${topic}. Para mejor calidad, configurá una API key de Claude o Gemini.`
      : `Auto-generated video about ${topic}. For better quality, configure a Claude or Gemini API key.`,
    scenes: [
      {
        type: 'presentation',
        durationSeconds: 12,
        narration: es
          ? `Hoy vamos a hablar de un tema que está generando mucho interés. Quedate hasta el final porque hay información que te va a sorprender.`
          : `Today we're going to talk about a topic that's generating a lot of interest. Stay until the end because there's information that will surprise you.`,
        slide: {
          headline: shortTopic,
          bodyText: es ? 'Todo lo que necesitás saber' : 'Everything you need to know',
          style: 'title',
          backgroundColor: '#020617',
          accentColor: '#6366f1',
        },
      },
      {
        type: 'video',
        durationSeconds: 7,
        narration: es
          ? `Arranquemos con lo más importante. Esto es lo que tenés que saber.`
          : `Let's start with the most important part. This is what you need to know.`,
        visualPrompt: `Cinematic establishing shot of modern technology environment, sleek displays showing data visualizations, cool blue and purple neon lighting, futuristic atmosphere, 4K professional quality`,
      },
      {
        type: 'presentation',
        durationSeconds: 20,
        narration: es
          ? `El tema es amplio, pero hay tres pilares fundamentales que lo definen. Primero, el contexto en el que surge. Segundo, las características principales que lo hacen relevante. Y tercero, el impacto que tiene y va a tener en el futuro cercano. Vamos punto por punto.`
          : `The topic is broad, but there are three fundamental pillars that define it. First, the context in which it emerges. Second, the main characteristics that make it relevant. And third, the impact it has and will have in the near future. Let's go point by point.`,
        slide: {
          headline: es ? 'Los 3 Pilares Clave' : '3 Key Pillars',
          bulletPoints: es
            ? ['El contexto actual', 'Características principales', 'Impacto a futuro']
            : ['Current context', 'Main characteristics', 'Future impact'],
          style: 'bullets',
          backgroundColor: '#0f172a',
          accentColor: '#3b82f6',
        },
      },
      {
        type: 'presentation',
        durationSeconds: 18,
        narration: es
          ? `Lo más interesante es lo que viene. Las tendencias apuntan a cambios significativos en los próximos meses. Los expertos coinciden en que estamos en un punto de inflexión, y los que se adapten primero van a tener una ventaja enorme.`
          : `The most interesting part is what's coming. Trends point to significant changes in the coming months. Experts agree we're at an inflection point, and those who adapt first will have an enormous advantage.`,
        slide: {
          headline: es ? 'Lo Que Viene' : "What's Coming",
          bulletPoints: es
            ? ['Tendencias emergentes', 'Punto de inflexión', 'Ventaja competitiva']
            : ['Emerging trends', 'Inflection point', 'Competitive advantage'],
          style: 'bullets',
          backgroundColor: '#1e1b4b',
          accentColor: '#8b5cf6',
        },
      },
      {
        type: 'video',
        durationSeconds: 7,
        narration: es
          ? `El futuro ya llegó. Y lo que viste hoy es solo la punta del iceberg.`
          : `The future is already here. And what you saw today is just the tip of the iceberg.`,
        visualPrompt: `Cinematic wide shot of a futuristic city skyline at golden hour, holographic displays floating in the air, warm and cool tones mixing, epic composition, 4K professional quality`,
      },
      {
        type: 'presentation',
        durationSeconds: 12,
        narration: es
          ? `Si este video te sirvió, dejá un like y suscribite para más contenido como este. Nos vemos en el próximo.`
          : `If this video was helpful, leave a like and subscribe for more content like this. See you in the next one.`,
        slide: {
          headline: es ? '¡Gracias por ver!' : 'Thanks for watching!',
          bodyText: es ? 'Suscribite para más' : 'Subscribe for more',
          style: 'transition',
          backgroundColor: '#020617',
          accentColor: '#6366f1',
        },
      },
    ],
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateScript(opts: GenerateOptions): Promise<ProjectPayload> {
  const projectId = uuidv4();
  let scriptData: LLMScriptResponse | undefined;
  let provider = 'template';

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
  const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

  // ── Data gathering: Wikipedia + Tavily + Pexels (run in parallel) ──────────
  let webContext: string | undefined;
  let wikiContext: string | undefined;
  let pexelsContext: string | undefined;

  // Run all data sources in parallel for speed
  const [tavilyResult, wikiResult, pexelsResult] = await Promise.allSettled([
    // Tavily — news/web search
    process.env.TAVILY_API_KEY
      ? (async () => {
          console.log(`[LLM] 🔍 Tavily search: "${opts.topic}"`);
          const r = await TavilyService.searchForTopic(opts.topic);
          if (r.results.length > 0) {
            console.log(`[LLM] ✅ Tavily: ${r.results.length} sources`);
            return TavilyService.formatForPrompt(r);
          }
          return undefined;
        })()
      : Promise.resolve(undefined),
    // Wikipedia — verified base knowledge (free, no API key)
    (async () => {
      console.log(`[LLM] 📚 Wikipedia search: "${opts.topic}"`);
      const ctx = await WikipediaService.getContextForTopic(opts.topic);
      if (ctx) console.log(`[LLM] ✅ Wikipedia: got context (${ctx.length} chars)`);
      return ctx;
    })(),
    // Pexels — real stock photos (free, no attribution)
    process.env.PEXELS_API_KEY
      ? (async () => {
          console.log(`[LLM] 🖼 Pexels search: "${opts.topic}"`);
          const { photos } = await PexelsService.getPhotosForTopic(opts.topic, 8);
          if (photos.length > 0) {
            console.log(`[LLM] ✅ Pexels: ${photos.length} photos`);
            return PexelsService.formatForPrompt(photos);
          }
          return undefined;
        })()
      : Promise.resolve(undefined),
  ]);

  webContext = tavilyResult.status === 'fulfilled' ? tavilyResult.value : undefined;
  wikiContext = wikiResult.status === 'fulfilled' ? wikiResult.value : undefined;
  pexelsContext = pexelsResult.status === 'fulfilled' ? pexelsResult.value : undefined;

  // Fallback: Gemini grounding if no Tavily results
  if (!webContext && GEMINI_API_KEY && !GEMINI_API_KEY.includes('your_')) {
    try {
      console.log(`[LLM] 🔍 Gemini grounding search: "${opts.topic}"`);
      webContext = await searchWithGeminiGrounding(opts.topic, GEMINI_API_KEY);
      if (webContext) console.log(`[LLM] ✅ Gemini grounding: got web context`);
    } catch (err: any) {
      console.warn(`[LLM] ⚠ Gemini grounding failed: ${err.message}`);
    }
  }

  // Combine all contexts for the prompt
  const combinedWebContext = [
    wikiContext ? `📚 DATOS VERIFICADOS DE WIKIPEDIA:\n${wikiContext}` : '',
    webContext || '',
    pexelsContext || '',
  ].filter(Boolean).join('\n\n') || undefined;

  const prompt = buildPrompt({ ...opts, webContext: combinedWebContext });

  // ── Provider chain: Gemini 3 Pro → Claude → Gemini 2.5 Pro → fallback ──
  const providers: Array<{
    name: string;
    key: string;
    call: (p: string, k: string) => Promise<string>;
  }> = [
    { name: 'gemini-3-pro',      key: GEMINI_API_KEY,    call: callGemini },
    { name: 'claude',            key: ANTHROPIC_API_KEY, call: callClaude },
    { name: 'gemini-2.5-pro',    key: GEMINI_API_KEY,    call: callGeminiFallback },
    { name: 'gemini-2.5-flash',  key: GEMINI_API_KEY,    call: callGeminiFlash },
  ];

  for (const prov of providers) {
    if (!prov.key || prov.key.includes('your_') || prov.key.includes('xxxx')) continue;
    try {
      const raw = await callWithRetry(prov.call, prompt, prov.key, prov.name);
      scriptData = postProcess(parseJSON(raw));
      provider = prov.name;
      console.log(`[LLM] ✅ ${prov.name}: ${scriptData.scenes.length} scenes for "${opts.topic}"`);
      break;
    } catch (err: any) {
      console.warn(`[LLM] ⚠ ${prov.name} failed: ${err.message}`);
    }
  }

  // ── Fallback template ─────────────────────────────────────────────────
  if (!scriptData) {
    console.warn(`[LLM] ⚠ All providers failed — using fallback template for: "${opts.topic}"`);
    scriptData = buildFallbackScript(opts);
  }

  console.log(`[LLM] Provider: ${provider} | Topic: "${opts.topic}" | Scenes: ${scriptData.scenes.length}`);

  // ── Build final payload ─────────────────────────────────────────────────
  const scenes: Scene[] = scriptData.scenes.map((s: LLMScene, idx: number) => ({
    sceneId: `s${idx + 1}`,
    type: s.type as SceneType,
    narration: s.narration,
    durationSeconds: s.durationSeconds,
    visualPrompt: s.visualPrompt,
    imagePrompt: s.imagePrompt,
    imageEffect: s.imageEffect as any,
    webImageUrl: s.webImageUrl,
    slide: s.slide ? {
      ...s.slide,
      style: (s.slide.style || 'bullets') as SlideStyle,
    } : undefined,
    sourceUrls: s.sourceUrls,
    voiceOptions: {
      speed: 1.0,
      language: opts.language,
    },
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
      generatedByLLM: provider !== 'template',
      provider,
    },
  };
}
