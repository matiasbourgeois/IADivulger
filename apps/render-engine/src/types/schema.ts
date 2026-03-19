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
}
