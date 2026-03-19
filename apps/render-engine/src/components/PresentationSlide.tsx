// @ts-nocheck — Remotion JSX types are resolved at bundle time, not by IDE
import React from 'react';
import { AbsoluteFill, Audio, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { RenderScene } from '../types/schema';

interface Props {
  scene: RenderScene;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toRgba = (hex: string, alpha: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const FILL: React.CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

// ─── BarChart sub-component ──────────────────────────────────────────────────

const BarChart: React.FC<{
  labels: string[];
  values: number[];
  unit?: string;
  accent: string;
  frame: number;
  fps: number;
}> = ({ labels, values, unit, accent, frame, fps }) => {
  const maxVal = Math.max(...values);

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end', height: 280, width: '100%', marginTop: 32 }}>
      {labels.map((label, i) => {
        const targetHeight = (values[i] / maxVal) * 240;
        // bars animate in with spring, staggered
        const barSpring = spring({ frame, fps, config: { damping: 16, stiffness: 90 }, delay: 10 + i * 10 });
        const barH = interpolate(barSpring, [0, 1], [0, targetHeight]);
        const barOpacity = interpolate(frame, [8 + i * 8, 22 + i * 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const isTop = values[i] === maxVal;

        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: barOpacity }}>
            {/* Value + unit label above bar */}
            <div style={{
              fontSize: 26, fontWeight: 900, color: isTop ? accent : 'rgba(255,255,255,0.85)',
              opacity: interpolate(frame, [20 + i * 8, 34 + i * 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            }}>
              {values[i]}{unit ? <span style={{ fontSize: 16, fontWeight: 500, marginLeft: 3 }}>{unit}</span> : ''}
            </div>
            {/* Bar */}
            <div style={{
              width: '100%', height: barH, borderRadius: '10px 10px 0 0',
              background: isTop
                ? `linear-gradient(180deg, ${accent}, ${toRgba(accent, 0.55)})`
                : 'rgba(255,255,255,0.15)',
              boxShadow: isTop ? `0 0 28px ${toRgba(accent, 0.45)}` : 'none',
              transition: 'height 0.3s',
            }} />
            {/* Label */}
            <div style={{ fontSize: 18, fontWeight: 700, color: isTop ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Source badge ────────────────────────────────────────────────────────────

const SourceBadge: React.FC<{ urls: string[]; accent: string; frame: number }> = ({ urls, accent, frame }) => {
  if (!urls || urls.length === 0) return null;
  const opacity = interpolate(frame, [30, 45], [0, 0.6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{
      position: 'absolute', bottom: 44, right: 56, display: 'flex', flexDirection: 'column', gap: 6,
      opacity, alignItems: 'flex-end',
    }}>
      {urls.slice(0, 2).map((url, i) => {
        const domain = url.replace(/^https?:\/\//, '').split('/')[0];
        return (
          <div key={i} style={{
            background: 'rgba(0,0,0,0.55)', border: `1px solid ${toRgba(accent, 0.4)}`,
            borderRadius: 8, padding: '5px 12px', fontSize: 13, color: 'rgba(255,255,255,0.7)',
            backdropFilter: 'blur(8px)',
          }}>
            📎 {domain}
          </div>
        );
      })}
    </div>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────

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
  const sourceUrls = (scene as any).sourceUrls as string[] | undefined;

  return (
    <AbsoluteFill style={{ background: bg, opacity: fadeIn, fontFamily: "'Inter', 'system-ui', sans-serif" }}>
      {/* Gradient glow backdrop */}
      <div style={{ ...FILL, background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${toRgba(accent, 0.18)}, transparent 65%)` }} />
      {/* Bottom subtle vignette */}
      <div style={{ ...FILL, background: 'linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.4))' }} />

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

        {/* STATS — animated counter */}
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

        {/* BAR CHART — comparativa animada */}
        {style === 'bar_chart' && (
          <div style={{ width: '100%', maxWidth: 1200 }}>
            <h2 style={{ fontSize: 52, fontWeight: 900, color: '#fff', margin: '0 0 16px', borderLeft: `6px solid ${accent}`, paddingLeft: 28, transform: `translateY(${titleY}px)` }}>{slide?.headline}</h2>
            {slide?.chartData ? (
              <BarChart
                labels={slide.chartData.labels}
                values={slide.chartData.values}
                unit={slide.chartData.unit}
                accent={accent}
                frame={frame}
                fps={fps}
              />
            ) : (
              // Fallback to bullets if no chartData
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 24 }}>
                {(slide?.bulletPoints || []).map((bp, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18, opacity: bulletOpacity(i), transform: `translateX(${bulletX(i)}px)` }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
                    <span style={{ fontSize: 28, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>{bp}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TRANSITION / default */}
        {(style === 'transition' || !['title', 'chapter', 'bullets', 'quote', 'stats', 'bar_chart'].includes(style)) && (
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 74, fontWeight: 900, color: '#fff', letterSpacing: '-2px', margin: 0, transform: `translateY(${titleY}px)`, whiteSpace: 'pre-line' }}>{slide?.headline}</h1>
            <div style={{ width: interpolate(frame, [8, 48], [0, 150], { extrapolateRight: 'clamp' }), height: 3, background: accent, borderRadius: 2, margin: '32px auto 0' }} />
            {slide?.bodyText && (
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 26, marginTop: 28, opacity: interpolate(frame, [20, 38], [0, 1], { extrapolateRight: 'clamp' }) }}>{slide.bodyText}</p>
            )}
          </div>
        )}

      </AbsoluteFill>

      {/* Watermark */}
      <div style={{ position: 'absolute', top: 38, left: 48, display: 'flex', alignItems: 'center', gap: 10, opacity: 0.22 }}>
        <div style={{ width: 26, height: 26, background: accent, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 10 }}>IA</div>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, letterSpacing: '3px', textTransform: 'uppercase' }}>IADivulger</span>
      </div>

      {/* Tavily source attribution badges */}
      {sourceUrls && <SourceBadge urls={sourceUrls} accent={accent} frame={frame} />}

      {/* Audio */}
      {scene.audioUrl && scene.audioUrl.length > 4 && <Audio src={scene.audioUrl} />}
    </AbsoluteFill>
  );
};
