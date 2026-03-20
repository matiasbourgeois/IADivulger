export type SceneType = 'presentation' | 'video' | 'image' | 'web_image';
export type SlideStyle = 'title' | 'bullets' | 'quote' | 'stats' | 'transition' | 'chapter' | 'bar_chart';

export interface SlideData {
  headline: string;
  bodyText?: string;
  bulletPoints?: string[];
  statValue?: string;
  statLabel?: string;
  style: SlideStyle;
  backgroundColor?: string;
  accentColor?: string;
  chartData?: {
    labels: string[];
    values: number[];
    unit?: string;
  };
}

export interface VoiceOptions {
  speed: number;
  language: string;
}

// ─── Subtitle Configuration ─────────────────────────────────────────────────

export type SubtitleStyle = 'word_by_word' | 'sentence';
export type SubtitleSize = 'small' | 'medium' | 'large';
export type SubtitleBackground = 'none' | 'dark' | 'solid';
export type SubtitlePosition = 'bottom' | 'center' | 'top';

export interface SubtitleConfig {
  enabled: boolean;
  style: SubtitleStyle;       // word_by_word = word highlight, sentence = full sentence
  fontSize: SubtitleSize;     // small=22px, medium=28px, large=36px
  background: SubtitleBackground; // none=text-shadow, dark=glass blur, solid=black bar
  position: SubtitlePosition; // bottom/center/top
  accentColor?: string;       // highlight color for active word
}

export const DEFAULT_SUBTITLE_CONFIG: SubtitleConfig = {
  enabled: true,
  style: 'word_by_word',
  fontSize: 'medium',
  background: 'dark',
  position: 'bottom',
  accentColor: '#6366f1',
};

// ─── Scene & Payload ────────────────────────────────────────────────────────

export interface RenderScene {
  sceneId: string;
  type: SceneType;
  narrationText: string;
  assetUrl?: string;      // For type='video' and 'image' scenes
  audioUrl?: string;      // TTS audio URL
  durationInSeconds: number;
  slide?: SlideData;      // For type='presentation' scenes
  imageEffect?: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'ken_burns';
  webImageUrl?: string;     // Real photo URL from Pexels/Wikipedia
  sourceUrls?: string[];  // Tavily web sources
}

export interface RenderPayload {
  projectId: string;
  title: string;
  description?: string;
  format: '16:9' | '9:16' | '1:1';
  scenes: RenderScene[];
  subtitleConfig?: SubtitleConfig;
}
