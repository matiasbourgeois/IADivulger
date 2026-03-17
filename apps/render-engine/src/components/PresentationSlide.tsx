// @ts-nocheck — Remotion JSX types are resolved at bundle time, not by IDE
import React from 'react';
import { AbsoluteFill, Audio, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { RenderScene } from '../types/schema';

interface Props {
  scene: RenderScene;
}

const toRgba = (hex: string, alpha: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const FILL: React.CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

export const PresentationSlide: React.FC<Props> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slide = scene.slide;

  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const titleSpring = spring({ frame, fps, config: { damping: 14, stiffness: 80 }, delay: 4 });
  const titleY = interpolate(titleSpring, [0, 1], [38, 0]);

  const bulletOpacity = (i: number) => interpolate(frame, [8 + i * 8, 24 + i * 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const bulletX = (i: number) => interpolate(frame, [8 + i * 8, 24 + i * 8], [-25, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const accentFade = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });

  const bg = slide?.backgroundColor || '#0f172a';
  const accent = slide?.accentColor || '#6366f1';
  const style = slide?.style || 'title';

  return (
    <AbsoluteFill style={{ background: bg, opacity: fadeIn, fontFamily: 'system-ui, sans-serif' }}>
      {/* Background glow */}
      <div style={{ ...FILL, background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${toRgba(accent, 0.18)}, transparent 65%)` }} />

      {/* Main content */}
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 140px' }}>

        {/* TITLE */}
        {style === 'title' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 60, height: 4, borderRadius: 2, background: accent, margin: '0 auto 36px', opacity: accentFade }} />
            <h1 style={{ fontSize: 92, fontWeight: 900, color: '#fff', lineHeight: 1.05, margin: 0, letterSpacing: '-3px', transform: `translateY(${titleY}px)`, whiteSpace: 'pre-line', textShadow: `0 0 80px ${toRgba(accent, 0.45)}` }}>
              {slide?.headline}
            </h1>
            {slide?.bodyText && (
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 28, margin: '28px 0 0', opacity: interpolate(frame, [20, 35], [0, 1], { extrapolateRight: 'clamp' }) }}>
                {slide.bodyText}
              </p>
            )}
          </div>
        )}

        {/* CHAPTER */}
        {style === 'chapter' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, color: accent, fontWeight: 800, letterSpacing: '6px', textTransform: 'uppercase', marginBottom: 14, opacity: accentFade }}>{slide?.bodyText || 'Capítulo'}</div>
            <h1 style={{ fontSize: 82, fontWeight: 900, color: '#fff', letterSpacing: '-2px', margin: 0, transform: `translateY(${titleY}px)` }}>{slide?.headline}</h1>
            <div style={{ width: 90, height: 3, background: accent, borderRadius: 2, margin: '28px auto 0' }} />
          </div>
        )}

        {/* BULLETS */}
        {style === 'bullets' && (
          <div style={{ width: '100%', maxWidth: 1400 }}>
            <h2 style={{ fontSize: 54, fontWeight: 900, color: '#fff', margin: '0 0 44px', borderLeft: `6px solid ${accent}`, paddingLeft: 28, transform: `translateY(${titleY}px)` }}>{slide?.headline}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {(slide?.bulletPoints || []).map((bp, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: bulletOpacity(i), transform: `translateX(${bulletX(i)}px)`, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '18px 26px' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: accent, flexShrink: 0, boxShadow: `0 0 14px ${toRgba(accent, 0.7)}` }} />
                  <span style={{ fontSize: 30, color: 'rgba(255,255,255,0.88)', fontWeight: 600 }}>{bp}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* QUOTE */}
        {style === 'quote' && (
          <div style={{ textAlign: 'center', maxWidth: 1200 }}>
            <div style={{ fontSize: 150, color: accent, lineHeight: 0.5, marginBottom: 28, opacity: 0.22, fontFamily: 'Georgia, serif' }}>"</div>
            <h2 style={{ fontSize: 56, fontWeight: 700, color: '#fff', lineHeight: 1.3, fontStyle: 'italic', margin: 0, transform: `translateY(${titleY}px)`, whiteSpace: 'pre-line' }}>{slide?.headline}</h2>
            {slide?.bodyText && (
              <p style={{ color: accent, fontSize: 24, marginTop: 36, fontWeight: 700, opacity: interpolate(frame, [20, 35], [0, 1], { extrapolateRight: 'clamp' }) }}>{slide.bodyText}</p>
            )}
          </div>
        )}

        {/* STATS */}
        {style === 'stats' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: 170, fontWeight: 900, lineHeight: 0.9,
              background: `linear-gradient(135deg, #fff 0%, ${accent} 100%)`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              transform: `scale(${spring({ frame, fps, config: { damping: 12, stiffness: 55 } })})`,
              display: 'inline-block',
            }}>{slide?.statValue || slide?.headline}</div>
            <p style={{ fontSize: 30, color: 'rgba(255,255,255,0.5)', marginTop: 28, opacity: interpolate(frame, [14, 28], [0, 1], { extrapolateRight: 'clamp' }) }}>{slide?.statLabel || slide?.bodyText}</p>
          </div>
        )}

        {/* TRANSITION / default */}
        {(style === 'transition' || !['title', 'chapter', 'bullets', 'quote', 'stats'].includes(style)) && (
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 74, fontWeight: 900, color: '#fff', letterSpacing: '-2px', margin: 0, transform: `translateY(${titleY}px)`, whiteSpace: 'pre-line' }}>{slide?.headline}</h1>
            <div style={{ width: interpolate(frame, [8, 48], [0, 150], { extrapolateRight: 'clamp' }), height: 3, background: accent, borderRadius: 2, margin: '32px auto 0' }} />
          </div>
        )}

      </AbsoluteFill>

      {/* Watermark */}
      <div style={{ position: 'absolute', top: 38, left: 48, display: 'flex', alignItems: 'center', gap: 10, opacity: 0.22 }}>
        <div style={{ width: 26, height: 26, background: accent, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 10 }}>IA</div>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, letterSpacing: '3px', textTransform: 'uppercase' }}>IADivulger</span>
      </div>

      {/* Audio — ONLY when valid URL. Empty string crashes Remotion renderer. */}
      {scene.audioUrl && scene.audioUrl.length > 4 && <Audio src={scene.audioUrl} />}
    </AbsoluteFill>
  );
};
