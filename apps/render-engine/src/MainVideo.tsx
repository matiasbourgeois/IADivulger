// @ts-nocheck — Remotion 4 types resolve at bundle time via Remotion's own bundler
import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { PresentationSlide } from './components/PresentationSlide';
import { VideoScene } from './components/VideoScene';
import { ImageScene } from './components/ImageScene';
import { SubtitleConfig, DEFAULT_SUBTITLE_CONFIG } from './types/schema';

// Simple fade wrapper (no overlap — avoids frame math mismatch with RemotionService)
const FadeWrapper: React.FC<{ children: React.ReactNode; durationInFrames: number }> = 
  ({ children, durationInFrames }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
      {children}
    </AbsoluteFill>
  );
};

// Safe scene renderer — catches errors to prevent one scene from killing the whole video
const SafeScene: React.FC<{ scene: any; format: string; subtitleConfig: SubtitleConfig; durationInFrames: number }> = 
  ({ scene, format, subtitleConfig, durationInFrames }) => {
  try {
    if (scene.type === 'presentation') {
      return <PresentationSlide scene={scene} subtitleConfig={subtitleConfig} />;
    }
    if (scene.type === 'image' || scene.type === 'web_image') {
      return <ImageScene scene={scene} subtitleConfig={subtitleConfig} />;
    }
    // video
    return <VideoScene scene={scene} format={format} subtitleConfig={subtitleConfig} />;
  } catch (err) {
    // Fallback: show a simple dark slide with the narration text
    return (
      <AbsoluteFill style={{ background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
        <p style={{ color: '#fff', fontSize: 32, textAlign: 'center', fontFamily: 'sans-serif' }}>
          {scene.narrationText || 'Error rendering scene'}
        </p>
      </AbsoluteFill>
    );
  }
};

export const MainVideo: React.FC<{ payload: any; format: any }> = ({ payload, format }) => {
  const fps = 30;

  if (!payload?.scenes?.length) {
    return (
      <AbsoluteFill style={{ background: '#1a0000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#f87171', fontSize: 36, fontFamily: 'sans-serif' }}>Error: no scenes in payload</p>
      </AbsoluteFill>
    );
  }

  const subtitleConfig: SubtitleConfig = {
    ...DEFAULT_SUBTITLE_CONFIG,
    ...(payload.subtitleConfig || {}),
  };

  // Sequential layout — NO overlap, matches RemotionService totalFrames exactly
  let currentStart = 0;
  const sceneLayout = payload.scenes.map((scene: any, index: number) => {
    const dur = Math.max(30, Math.floor((scene.durationInSeconds || 5) * fps));
    const start = currentStart;
    currentStart += dur;
    return { scene, start, dur, index };
  });

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {sceneLayout.map(({ scene, start, dur, index }: any) => (
        <Sequence key={`scene-${scene.sceneId || index}`} from={start} durationInFrames={dur}>
          <FadeWrapper durationInFrames={dur}>
            <SafeScene scene={scene} format={format || '16:9'} subtitleConfig={subtitleConfig} durationInFrames={dur} />
          </FadeWrapper>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
