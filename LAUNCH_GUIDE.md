# 🎬 Guía: Lanzar Tu Primer Video

## Paso 1 — Arrancar los servicios (4 terminales)

```powershell
# Terminal 1 — ComfyUI (GPU)
cd apps/comfyui && .venv\Scripts\python.exe main.py --port 8189 --lowvram

# Terminal 2 — AI Worker (Python)
cd apps/ai-worker && .venv\Scripts\python.exe -m uvicorn main:app --port 8000

# Terminal 3 — Backend (Node)
npx tsx apps/backend/src/server.ts

# Terminal 4 — Dashboard (Next.js)
cd apps/dashboard && npm run dev
```

## Paso 2 — Generar el video

1. Abrí **http://localhost:3000**
2. Escribí el tema: `La historia de la IA: de Turing a ChatGPT`
3. Elegí duración: **10 minutos** / idioma: **Español**
4. Click **"Generar Video Automático"** → el LLM crea el guión
5. En el editor: revisá/editá cada escena si querés
6. Click **"Aprobar y Generar"** → pipeline inicia

### Tiempos estimados (RTX 3090)
| Fase | Tiempo |
|------|--------|
| TTS por escena | ~15-30s |
| Video Wan 2.2 por clip (3 clips) | ~5-15 min c/u |
| Render Remotion | ~1 min |
| **Total video de 10 min** | **~30-50 min** |

---

## ¿API de Gemini o LLM local?

### ✅ Gemini Flash 2.0 = RECOMENDADO para generar el guión

| | Gemini Flash API | Llama local (7B) |
|--|--|--|
| Costo | **$0** (free tier 1M tokens/día) | 0 + 4GB descarga |
| Calidad del guión | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Velocidad | 1-3 segundos | 30-90 segundos |
| VRAM usada | **Ninguna** | 4-6GB |

> **La clave**: tu RTX 3090 todo lo necesita Wan 2.2 (14B fp8 ~18-22GB VRAM). Un LLM local pelearía por VRAM. Gemini genera el guión en 2s desde la nube, sin tocar la GPU.

### Cómo activar Gemini (gratis, sin tarjeta):
1. Ve a **https://aistudio.google.com/apikey**
2. Creá la key
3. Agregar en `apps/backend/.env`:
```env
GEMINI_API_KEY=AIzaSy_tu_key_aqui
```
4. Reiniciar backend

---

## .env completo (apps/backend/.env)

```env
NODE_ENV=development
PORT=3001
AI_WORKER_URL=http://localhost:8000

GEMINI_API_KEY=        # ← agregar para guiones reales ($0)
ELEVENLABS_API_KEY=    # ← opcional, mejor voz (~0.001 USD/min)
AUDIO_PROVIDER=local   # cambiar a 'elevenlabs' si tenés key
```

---

## Verificar sistema
```powershell
npx tsx apps/backend/src/test.ts
# Resultado esperado: 47+ tests ✅ en ~2 minutos
```
