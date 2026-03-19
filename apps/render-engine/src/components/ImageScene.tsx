// @ts-nocheck — Remotion JSX types resolve at bundle time, not IDE
import React from 'react';
import { AbsoluteFill, Audio, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { RenderScene } from '../types/schema';

interface Props {
  scene: RenderScene;
}

/**
 * ImageScene — renders a FLUX-generated still image with camera effects.
 *
 * Effects:
 *   zoom_in   — slow zoom from 1.0→1.25
 *   zoom_out  — slow zoom from 1.25→1.0
 *   pan_left  — horizontal slide right→center
 *   pan_right — horizontal slide left→center
 *   ken_burns — zoom_in + slight pan (cinematic)
 */
export const ImageScene: React.FC<Props> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const effect = scene.imageEffect || 'ken_burns';
  const assetUrl = scene.assetUrl ?? '';
  const hasImage = assetUrl.startsWith('http');

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
  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const opacity = fadeIn * fadeOut;

  const subtitleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

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
          background: 'linear-gradient(135deg, #0f172a, #1e1b4b)',
        }} />
      )}

      {/* Cinematic vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.5) 100%)',
        pointerEvents: 'none',
      }} />

      {/* Bottom gradient for subtitle readability */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.6) 100%)',
        pointerEvents: 'none',
      }} />

      {/* Subtitle */}
      {scene.narrationText && (
        <AbsoluteFill style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 80px 68px' }}>
          <div style={{
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
            padding: '20px 34px',
            maxWidth: 1180,
            opacity: subtitleOpacity,
          }}>
            <p style={{
              color: '#fff',
              fontSize: 32,
              fontWeight: 700,
              textAlign: 'center',
              lineHeight: 1.35,
              margin: 0,
              textShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}>
              {scene.narrationText}
            </p>
          </div>
        </AbsoluteFill>
      )}

      {/* Watermark */}
      <div style={{
        position: 'absolute', top: 36, left: 46,
        display: 'flex', alignItems: 'center', gap: 10, opacity: 0.32,
      }}>
        <div style={{
          width: 26, height: 26, background: '#6366f1', borderRadius: 7,
          color: '#fff', fontWeight: 900, fontSize: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>IA</div>
        <span style={{
          color: '#fff', fontWeight: 800, fontSize: 12,
          letterSpacing: '3px', textTransform: 'uppercase',
        }}>IADivulger</span>
      </div>

      {/* Source badge */}
      {scene.sourceUrls && scene.sourceUrls.length > 0 && (
        <div style={{
          position: 'absolute', top: 36, right: 46,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
          borderRadius: 8, padding: '6px 12px',
          opacity: 0.5,
        }}>
          <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600 }}>
            📎 {scene.sourceUrls.length} fuente{scene.sourceUrls.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Audio */}
      {scene.audioUrl && scene.audioUrl.length > 4 && <Audio src={scene.audioUrl} />}

    </AbsoluteFill>
  );
};
