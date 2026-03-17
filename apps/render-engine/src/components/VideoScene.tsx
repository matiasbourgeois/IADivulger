// @ts-nocheck — Remotion JSX types resolve at bundle time, not IDE
import React from 'react';
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, useCurrentFrame } from 'remotion';
import { RenderScene } from '../types/schema';

interface Props {
  scene: RenderScene;
  format: '16:9' | '9:16' | '1:1';
}

const FILL: React.CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

export const VideoScene: React.FC<Props> = ({ scene }) => {
  const frame = useCurrentFrame();

  const scale = interpolate(frame, [0, 900], [1.0, 1.1], { extrapolateRight: 'clamp' });
  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const subtitleOpacity = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: 'clamp' });

  const assetUrl = scene.assetUrl ?? '';
  const hasAsset = assetUrl.startsWith('http');
  const isVideoFile = hasAsset && (assetUrl.includes('.mp4') || assetUrl.includes('.webm'));

  return (
    <AbsoluteFill style={{ background: '#000', opacity: fadeIn }}>

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
      <div style={{ ...FILL, background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), transparent 30%, rgba(0,0,0,0.5) 100%)', pointerEvents: 'none' }} />

      {/* Subtitle */}
      {scene.narrationText && (
        <AbsoluteFill style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 80px 68px' }}>
          <div style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '20px 34px', maxWidth: 1180, opacity: subtitleOpacity }}>
            <p style={{ color: '#fff', fontSize: 32, fontWeight: 700, textAlign: 'center', lineHeight: 1.35, margin: 0 }}>
              {scene.narrationText}
            </p>
          </div>
        </AbsoluteFill>
      )}

      {/* Watermark */}
      <div style={{ position: 'absolute', top: 36, left: 46, display: 'flex', alignItems: 'center', gap: 10, opacity: 0.32 }}>
        <div style={{ width: 26, height: 26, background: '#6366f1', borderRadius: 7, color: '#fff', fontWeight: 900, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>IA</div>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 12, letterSpacing: '3px', textTransform: 'uppercase' }}>IADivulger</span>
      </div>

      {/* Audio — ONLY when URL is valid */}
      {scene.audioUrl && scene.audioUrl.length > 4 && <Audio src={scene.audioUrl} />}

    </AbsoluteFill>
  );
};
