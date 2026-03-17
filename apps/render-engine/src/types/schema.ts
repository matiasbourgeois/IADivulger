export type SceneType = 'presentation' | 'video';
export type SlideStyle = 'title' | 'bullets' | 'quote' | 'stats' | 'transition' | 'chapter';

export interface SlideData {
  headline: string;
  bodyText?: string;
  bulletPoints?: string[];
  statValue?: string;
  statLabel?: string;
  style: SlideStyle;
  backgroundColor?: string;
  accentColor?: string;
}

export interface VoiceOptions {
  speed: number;
  language: string;
}

export interface RenderScene {
  sceneId: string;
  type: SceneType;
  narrationText: string;
  assetUrl?: string;      // For type='video' scenes
  audioUrl?: string;      // TTS audio URL
  durationInSeconds: number;
  slide?: SlideData;      // For type='presentation' scenes
}

export interface RenderPayload {
  projectId: string;
  title: string;
  description?: string;
  format: '16:9' | '9:16' | '1:1';
  scenes: RenderScene[];
}
