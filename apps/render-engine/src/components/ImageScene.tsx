// @ts-nocheck — Remotion JSX types resolve at bundle time, not IDE
import React from 'react';
import { AbsoluteFill, Audio, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { RenderScene, SubtitleConfig } from '../types/schema';
import { Subtitles } from './Subtitles';

interface Props {
  scene: RenderScene;
  subtitleConfig?: SubtitleConfig;
}

const toRgba = (hex: string, alpha: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

/**
 * ImageScene — renders a FLUX-generated or Pexels web image with premium camera effects.
 *
 * Effects: zoom_in, zoom_out, pan_left, pan_right, ken_burns
 */
export const ImageScene: React.FC<Props> = ({ scene, subtitleConfig }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  const effect = scene.imageEffect || 'ken_burns';
  const assetUrl = scene.assetUrl ?? '';
  const hasImage = assetUrl.startsWith('http') || assetUrl.startsWith('/') || assetUrl.startsWith('data:');
  const accent = '#6366f1';

  // ── Camera effect calculations ──────────────────────────────────────────
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: 'clamp' });

  let transform = '';
  switch (effect) {
    case 'zoom_in':
      const scaleIn = interpolate(progress, [0, 1], [1.0, 1.25]);
      transform = `scale(${scaleIn})`;
      break;
    case 'zoom_out':
      const scaleOut = interpolate(progress, [0, 1], [1.25, 1.0]);
      transform = `scale(${scaleOut})`;
      break;
    case 'pan_left':
      const panL = interpolate(progress, [0, 1], [5, -5]);
      transform = `scale(1.15) translateX(${panL}%)`;
      break;
    case 'pan_right':
      const panR = interpolate(progress, [0, 1], [-5, 5]);
      transform = `scale(1.15) translateX(${panR}%)`;
      break;
    case 'ken_burns':
    default:
      const scaleKB = interpolate(progress, [0, 1], [1.0, 1.2]);
      const panKB = interpolate(progress, [0, 1], [0, -3]);
      transform = `scale(${scaleKB}) translateX(${panKB}%) translateY(${panKB * 0.5}%)`;
      break;
  }

  // ── Fade in/out ─────────────────────────────────────────────────────────
  const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const opacity = fadeIn * fadeOut;

  // ── Subtitle animation ─────────────────────────────────────────────────
  const subtitleSpring = spring({ frame, fps, config: { damping: 14, stiffness: 70 }, delay: 8 });
  const subtitleY = interpolate(subtitleSpring, [0, 1], [20, 0]);
  const subtitleOpacity = interpolate(frame, [5, 22], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#000', opacity }}>

      {/* Image with camera effect */}
      {hasImage ? (
        <AbsoluteFill style={{ overflow: 'hidden' }}>
          <Img
            src={assetUrl}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform,
              transformOrigin: 'center center',
              willChange: 'transform',
            }}
          />
        </AbsoluteFill>
      ) : (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, #0f172a, #1e1b4b, #0f172a)',
        }} />
      )}

      {/* Cinematic vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)',
        pointerEvents: 'none',
      }} />

      {/* Bottom gradient — heavier for subtitle readability */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, transparent 45%, rgba(0,0,0,0.7) 85%, rgba(0,0,0,0.85) 100%)',
        pointerEvents: 'none',
      }} />

      {/* Top subtle gradient */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.3), transparent 25%)',
        pointerEvents: 'none',
      }} />

      {/* Subtitles (replaces old manually-styled subtitle) */}
      <Subtitles text={scene.narrationText || ''} config={subtitleConfig} />

      {/* Watermark */}
      <div style={{
        position: 'absolute', top: 36, left: 46,
        display: 'flex', alignItems: 'center', gap: 10, opacity: 0.25,
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8,
          background: 'linear-gradient(135deg, #6366f1, #818cf8)',
          color: '#fff', fontWeight: 900, fontSize: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 10px rgba(99,102,241,0.3)',
        }}>IA</div>
        <span style={{
          color: '#fff', fontWeight: 800, fontSize: 12,
          letterSpacing: '4px', textTransform: 'uppercase',
        }}>IADivulger</span>
      </div>

      {/* Source badge */}
      {scene.sourceUrls && scene.sourceUrls.length > 0 && (
        <div style={{
          position: 'absolute', top: 36, right: 46,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)',
          borderRadius: 10, padding: '6px 14px',
          border: '1px solid rgba(255,255,255,0.06)',
          opacity: interpolate(frame, [20, 35], [0, 0.5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}>
          <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600 }}>
            📎 {scene.sourceUrls.length} fuente{scene.sourceUrls.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Audio — delay 3 frames to fix audio starting before visual */}
      {scene.audioUrl && scene.audioUrl.length > 4 && <Audio src={scene.audioUrl} startFrom={3} />}

    </AbsoluteFill>
  );
};
