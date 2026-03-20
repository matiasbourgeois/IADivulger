export enum JobStatus {
  PENDING = 'PENDING',
  GENERATING_SCRIPT = 'GENERATING_SCRIPT', // LLM is writing the script
  AWAITING_REVIEW = 'AWAITING_REVIEW',     // Script ready, user reviewing
  QUEUED = 'QUEUED',                       // Approved but GPU busy — waiting in queue
  GENERATING_ASSETS = 'GENERATING_ASSETS', // TTS + Wan 2.2 running
  RENDERING = 'RENDERING',                 // Remotion compositing
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

// ─── Scene types ─────────────────────────────────────────────────────────────

export type SceneType = 'presentation' | 'video' | 'image' | 'web_image';

export type SlideStyle = 'title' | 'bullets' | 'quote' | 'stats' | 'transition' | 'chapter' | 'bar_chart';

export interface SlideData {
  headline: string;
  bodyText?: string;
  bulletPoints?: string[];
  statValue?: string;
  statLabel?: string;
  style: SlideStyle;
  backgroundColor?: string; // e.g. "#0f172a"
  accentColor?: string;
  chartData?: {            // For bar_chart slides
    labels: string[];
    values: number[];
    unit?: string;
  };
}

export interface VoiceOptions {
  speed: number;
  language: string;
  voiceId?: string;
}

export interface Scene {
  sceneId: string;
  type: SceneType;           // 'presentation' | 'video'
  narration: string;         // TTS text for all scenes
  durationSeconds: number;
  
  // For type='video' only
  visualPrompt?: string;
  
  // For type='presentation' only
  slide?: SlideData;

  // For type='image' — FLUX still image with camera effect
  imagePrompt?: string;
  
  // For type='web_image' — real photo from Pexels/Wikipedia
  webImageUrl?: string;        // Direct URL to the stock photo
  imageEffect?: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'ken_burns';
  
  voiceOptions: VoiceOptions;
  audioPath?: string;        // Real local path from AI Worker
  audioUrl?: string;         // Full URL for frontend
  assetPath?: string;        // Local path (video/image type)
  assetUrl?: string;         // Full URL (video/image type)
  sourceUrls?: string[];     // Web sources used in narration (from Tavily/Wikipedia)
}

export interface ProjectScript {
  scenes: Scene[];
}

export interface Metadata {
  createdAt: string;
  requestedBy: string;
  topic?: string;
  generatedByLLM?: boolean;
  provider?: string; // 'claude' | 'groq' | 'gemini' | 'template'
}

// ─── Subtitle configuration ─────────────────────────────────────────────────

export type SubtitleStyle = 'word_by_word' | 'sentence';
export type SubtitleSize = 'small' | 'medium' | 'large';
export type SubtitleBackground = 'none' | 'dark' | 'solid';
export type SubtitlePosition = 'bottom' | 'center' | 'top';

export interface SubtitleConfig {
  enabled: boolean;
  style: SubtitleStyle;
  fontSize: SubtitleSize;
  background: SubtitleBackground;
  position: SubtitlePosition;
  accentColor?: string;
}

export interface ProjectPayload {
  projectId: string;
  title: string;
  description?: string;
  targetDuration: number;
  formats: string[];
  language: string;
  script: ProjectScript;
  metadata: Metadata;
  subtitleConfig?: SubtitleConfig;
}

export interface Job {
  id: string;
  status: JobStatus;
  payload: ProjectPayload;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
  progress?: number;               // 0-100
  currentStep?: number;
  totalSteps?: number;
  estimatedRemainingSeconds?: number;
  currentPromptId?: string;
  finalVideoUrl?: string;
}

export interface AudioResult {
  audioPath: string;
  durationMs: number;
  provider: string;
}
