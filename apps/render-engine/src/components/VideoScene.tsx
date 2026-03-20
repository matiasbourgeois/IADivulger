// @ts-nocheck — Remotion JSX types resolve at bundle time, not IDE
import React from 'react';
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import { RenderScene, SubtitleConfig } from '../types/schema';
import { Subtitles } from './Subtitles';

interface Props {
  scene: RenderScene;
  format: '16:9' | '9:16' | '1:1';
  subtitleConfig?: SubtitleConfig;
}

const FILL: React.CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

export const VideoScene: React.FC<Props> = ({ scene, subtitleConfig }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const scale = interpolate(frame, [0, durationInFrames], [1.0, 1.1], { extrapolateRight: 'clamp' });
  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });

  const assetUrl = scene.assetUrl ?? '';
  const hasAsset = assetUrl.startsWith('http') || assetUrl.startsWith('/');
  const isVideoFile = hasAsset && (assetUrl.includes('.mp4') || assetUrl.includes('.webm'));

  return (
    <AbsoluteFill style={{ background: '#000', opacity: fadeIn * fadeOut }}>

      {/* Asset — only render when URL is valid */}
      {hasAsset && (
        <AbsoluteFill style={{ transform: `scale(${scale})`, overflow: 'hidden' }}>
          {isVideoFile
            ? <OffthreadVideo src={assetUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <img src={assetUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
          }
        </AbsoluteFill>
      )}

      {/* Gradient placeholder when no asset */}
      {!hasAsset && (
        <div style={{ ...FILL, background: 'linear-gradient(135deg, #0f172a, #1e1b4b)' }} />
      )}

      {/* Dark vignette */}
      <div style={{ ...FILL, background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), transparent 30%, rgba(0,0,0,0.55) 100%)', pointerEvents: 'none' }} />

      {/* Subtitles */}
      <Subtitles text={scene.narrationText || ''} config={subtitleConfig} />

      {/* Watermark */}
      <div style={{ position: 'absolute', top: 36, left: 46, display: 'flex', alignItems: 'center', gap: 10, opacity: 0.25 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8,
          background: 'linear-gradient(135deg, #6366f1, #818cf8)',
          color: '#fff', fontWeight: 900, fontSize: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 10px rgba(99,102,241,0.3)',
        }}>IA</div>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 12, letterSpacing: '4px', textTransform: 'uppercase' }}>IADivulger</span>
      </div>

      {/* Audio — delay 3 frames */}
      {scene.audioUrl && scene.audioUrl.length > 4 && <Audio src={scene.audioUrl} startFrom={3} />}

    </AbsoluteFill>
  );
};
