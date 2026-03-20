// @ts-nocheck — Remotion JSX types are resolved at bundle time, not by IDE
import React from 'react';
import { AbsoluteFill, Audio, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { RenderScene, SubtitleConfig } from '../types/schema';
import { Subtitles } from './Subtitles';

interface Props {
  scene: RenderScene;
  subtitleConfig?: SubtitleConfig;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toRgba = (hex: string, alpha: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const lighten = (hex: string, amount: number) => {
  const h = hex.replace('#', '');
  const r = Math.min(255, parseInt(h.slice(0, 2), 16) + Math.round(amount * 255));
  const g = Math.min(255, parseInt(h.slice(2, 4), 16) + Math.round(amount * 255));
  const b = Math.min(255, parseInt(h.slice(4, 6), 16) + Math.round(amount * 255));
  return `rgb(${r},${g},${b})`;
};

const FILL: React.CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

// ─── Cinematic particles ─────────────────────────────────────────────────────

const Particles: React.FC<{ accent: string; frame: number; count?: number }> = ({ accent, frame, count = 12 }) => {
  const ps = React.useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      x: (i * 137.508 + 23) % 100,
      y: (i * 89.37 + 17) % 100,
      size: 1.5 + (i % 4) * 1.2,
      speed: 0.08 + (i % 3) * 0.06,
      delay: i * 3,
      orbitR: 2 + (i % 3) * 1.5,
    })), [count]);

  return (
    <div style={FILL}>
      {ps.map((p, i) => {
        const op = interpolate(frame, [p.delay, p.delay + 10, p.delay + 80, p.delay + 100], [0, 0.4, 0.4, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const ox = Math.sin(frame * 0.03 + i) * p.orbitR;
        const oy = Math.cos(frame * 0.02 + i * 0.7) * p.orbitR * 0.5;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${p.x + ox}%`,
            top: `${((p.y - frame * p.speed * 0.3) % 115 + 115) % 115}%`,
            width: p.size, height: p.size, borderRadius: '50%',
            background: accent, opacity: op,
            boxShadow: `0 0 ${p.size * 4}px ${toRgba(accent, 0.6)}, 0 0 ${p.size * 8}px ${toRgba(accent, 0.2)}`,
          }} />
        );
      })}
    </div>
  );
};

// ─── Animated accent line with glow pulse ────────────────────────────────────

const AccentLine: React.FC<{ accent: string; frame: number; width?: number; delay?: number; center?: boolean }> = 
  ({ accent, frame, width = 80, delay = 0, center = false }) => {
  const lineWidth = interpolate(frame, [delay, delay + 14], [0, width], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const glowPulse = 0.5 + Math.sin(frame * 0.1) * 0.2;
  return (
    <div style={{
      width: lineWidth, height: 3, borderRadius: 3,
      background: `linear-gradient(90deg, ${accent}, ${lighten(accent, 0.2)}, ${toRgba(accent, 0.3)})`,
      boxShadow: `0 0 20px ${toRgba(accent, glowPulse)}, 0 0 40px ${toRgba(accent, glowPulse * 0.4)}`,
      opacity: interpolate(frame, [delay, delay + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      ...(center ? { margin: '0 auto' } : {}),
    }} />
  );
};

// ─── Glassmorphism card with hover-like glow ─────────────────────────────────

const GlassCard: React.FC<{ accent: string; children: React.ReactNode; style?: React.CSSProperties; glowActive?: boolean }> = 
  ({ accent, children, style, glowActive }) => (
  <div style={{
    background: `linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))`,
    backdropFilter: 'blur(20px)',
    border: `1px solid ${toRgba(accent, glowActive ? 0.35 : 0.12)}`,
    borderRadius: 20,
    padding: '24px 32px',
    boxShadow: glowActive 
      ? `0 0 30px ${toRgba(accent, 0.15)}, inset 0 1px 0 rgba(255,255,255,0.06)`
      : 'inset 0 1px 0 rgba(255,255,255,0.04)',
    ...style,
  }}>
    {children}
  </div>
);

// ─── Source badge ────────────────────────────────────────────────────────────

const SourceBadge: React.FC<{ urls: string[]; frame: number }> = ({ urls, frame }) => {
  if (!urls || urls.length === 0) return null;
  const opacity = interpolate(frame, [15, 28], [0, 0.5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', bottom: 40, right: 48, display: 'flex', flexDirection: 'column', gap: 5, opacity, alignItems: 'flex-end' }}>
      {urls.slice(0, 2).map((url, i) => {
        let label = '🌐 Web';
        try {
          const host = new URL(url).hostname;
          if (host.includes('wikipedia')) label = '📚 Wikipedia';
          else if (host.includes('tavily') || host.includes('google')) label = '🔍 Web Search';
          else label = `📎 ${host.replace('www.', '').split('.')[0]}`;
        } catch {}
        return (
          <div key={i} style={{
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(10px)',
            borderRadius: 8, padding: '4px 12px', fontSize: 11,
            color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.06)',
          }}>{label}</div>
        );
      })}
    </div>
  );
};

// ─── Animated bar chart with spring physics ──────────────────────────────────

const BarChart: React.FC<{
  labels: string[]; values: number[]; unit?: string;
  accent: string; frame: number; fps: number;
}> = ({ labels, values, unit, accent, frame, fps }) => {
  const maxVal = Math.max(...values);
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', height: 240, width: '100%', marginTop: 20 }}>
      {labels.map((label, i) => {
        const targetH = (values[i] / maxVal) * 200;
        const barSpring = spring({ frame, fps, config: { damping: 12, stiffness: 60 }, delay: 6 + i * 6 });
        const barH = interpolate(barSpring, [0, 1], [0, targetH]);
        const op = interpolate(frame, [4 + i * 5, 16 + i * 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const isTop = values[i] === maxVal;
        const glowPulse = isTop ? 0.3 + Math.sin(frame * 0.08) * 0.15 : 0;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, opacity: op }}>
            <div style={{
              fontSize: 24, fontWeight: 900,
              color: isTop ? '#fff' : 'rgba(255,255,255,0.7)',
              textShadow: isTop ? `0 0 20px ${toRgba(accent, 0.6)}` : 'none',
            }}>
              {values[i]}{unit ? <span style={{ fontSize: 14, fontWeight: 500, marginLeft: 2 }}>{unit}</span> : ''}
            </div>
            <div style={{
              width: '100%', height: barH, borderRadius: '12px 12px 4px 4px',
              background: isTop
                ? `linear-gradient(180deg, ${lighten(accent, 0.15)}, ${accent}, ${toRgba(accent, 0.3)})`
                : `linear-gradient(180deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05))`,
              boxShadow: isTop ? `0 0 30px ${toRgba(accent, glowPulse)}, inset 0 1px 0 rgba(255,255,255,0.15)` : 'inset 0 1px 0 rgba(255,255,255,0.05)',
              border: `1px solid ${isTop ? toRgba(accent, 0.4) : 'rgba(255,255,255,0.08)'}`,
            }} />
            <div style={{
              fontSize: 14, fontWeight: 700,
              color: isTop ? accent : 'rgba(255,255,255,0.4)',
              textAlign: 'center', textShadow: isTop ? `0 0 10px ${toRgba(accent, 0.4)}` : 'none',
            }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Cinematic background ────────────────────────────────────────────────────

const CinematicBG: React.FC<{ bg: string; accent: string; frame: number; durationInFrames: number }> = 
  ({ bg, accent, frame, durationInFrames }) => {
  const drift = interpolate(frame, [0, durationInFrames], [0, -2], { extrapolateRight: 'clamp' });
  const breathe = Math.sin(frame * 0.04) * 0.03;

  return (
    <>
      {/* Base */}
      <div style={{ ...FILL, background: bg }} />
      
      {/* Animated gradient orbs */}
      <div style={{
        ...FILL,
        background: `
          radial-gradient(ellipse 90% 60% at ${30 + drift * -2}% ${20 + breathe * 100}%, ${toRgba(accent, 0.22)}, transparent 55%),
          radial-gradient(ellipse 60% 80% at ${75 + drift}% ${80 - breathe * 50}%, ${toRgba(accent, 0.12)}, transparent 50%),
          radial-gradient(ellipse 40% 40% at 50% 50%, ${toRgba(accent, 0.06)}, transparent 60%)
        `,
        transform: `translate(${drift}%, ${drift * 0.2}%)`,
      }} />

      {/* Subtle grid with parallax */}
      <div style={{
        ...FILL,
        backgroundImage: `linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
        backgroundPosition: `${drift * 3}px ${drift * 2}px`,
        opacity: 0.5,
      }} />

      {/* Top/bottom vignettes */}
      <div style={{ ...FILL, background: 'linear-gradient(to bottom, rgba(0,0,0,0.2), transparent 35%, transparent 65%, rgba(0,0,0,0.35))' }} />
    </>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────

export const PresentationSlide: React.FC<Props> = ({ scene, subtitleConfig }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const slide = scene.slide;

  // Master animations
  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 5, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const masterOpacity = fadeIn * fadeOut;
  
  const titleSpring = spring({ frame, fps, config: { damping: 10, stiffness: 50 }, delay: 2 });
  const titleY = interpolate(titleSpring, [0, 1], [35, 0]);
  const titleScale = interpolate(titleSpring, [0, 1], [0.95, 1]);

  const bg = slide?.backgroundColor || '#0f172a';
  const accent = slide?.accentColor || '#6366f1';
  const style = slide?.style || 'title';
  const sourceUrls = (scene as any).sourceUrls as string[] | undefined;

  // Stats-specific animations (safe to compute even if not used)
  const statsScaleSpring = spring({ frame, fps, config: { damping: 8, stiffness: 40 } });
  const statsGlowIntensity = 0.4 + Math.sin(frame * 0.06) * 0.15;

  return (
    <AbsoluteFill style={{ opacity: masterOpacity, fontFamily: "'Inter', 'Outfit', system-ui, sans-serif" }}>
      
      <CinematicBG bg={bg} accent={accent} frame={frame} durationInFrames={durationInFrames} />
      <Particles accent={accent} frame={frame} count={10} />

      {/* Main content */}
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '70px 100px' }}>

        {/* ═══ TITLE — Cinematic with light sweep ═══ */}
        {style === 'title' && (
          <div style={{ textAlign: 'center', transform: `translateY(${titleY}px) scale(${titleScale})` }}>
            <AccentLine accent={accent} frame={frame} width={80} delay={1} center />
            <div style={{ height: 20 }} />
            <h1 style={{
              fontSize: 86, fontWeight: 900, color: '#fff', lineHeight: 1.0, margin: 0,
              letterSpacing: '-3px', whiteSpace: 'pre-line',
              textShadow: `0 0 60px ${toRgba(accent, 0.4)}, 0 0 120px ${toRgba(accent, 0.15)}, 0 4px 8px rgba(0,0,0,0.4)`,
            }}>
              {slide?.headline}
            </h1>
            {slide?.bodyText && (
              <p style={{
                color: 'rgba(255,255,255,0.35)', fontSize: 22, margin: '22px 0 0',
                fontWeight: 500, letterSpacing: '2px', textTransform: 'uppercase',
                opacity: interpolate(frame, [12, 20], [0, 1], { extrapolateRight: 'clamp' }),
              }}>
                {slide.bodyText}
              </p>
            )}
            {/* Animated light sweep on title */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              background: `linear-gradient(105deg, transparent 30%, ${toRgba(accent, 0.08)} 50%, transparent 70%)`,
              transform: `translateX(${interpolate(frame, [5, 35], [-120, 120], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}%)`,
              pointerEvents: 'none',
            }} />
          </div>
        )}

        {/* ═══ CHAPTER — Number + title ═══ */}
        {style === 'chapter' && (
          <div style={{ textAlign: 'center', transform: `translateY(${titleY}px) scale(${titleScale})` }}>
            <div style={{
              fontSize: 15, color: accent, fontWeight: 800, letterSpacing: '10px',
              textTransform: 'uppercase', marginBottom: 18,
              opacity: interpolate(frame, [3, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              textShadow: `0 0 30px ${toRgba(accent, 0.6)}`,
            }}>
              {slide?.bodyText || 'Capítulo'}
            </div>
            <h1 style={{
              fontSize: 76, fontWeight: 900, color: '#fff', letterSpacing: '-2px', margin: 0,
              textShadow: `0 0 50px ${toRgba(accent, 0.3)}, 0 2px 6px rgba(0,0,0,0.4)`,
            }}>
              {slide?.headline}
            </h1>
            <div style={{ height: 20 }} />
            <AccentLine accent={accent} frame={frame} width={120} delay={6} center />
          </div>
        )}

        {/* ═══ BULLETS — Staggered glass cards with glow ═══ */}
        {style === 'bullets' && (
          <div style={{ width: '100%', maxWidth: 1200 }}>
            <div style={{ transform: `translateY(${titleY}px)`, marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 4, height: 40, borderRadius: 3,
                  background: `linear-gradient(180deg, ${lighten(accent, 0.15)}, ${accent}, ${toRgba(accent, 0.2)})`,
                  boxShadow: `0 0 16px ${toRgba(accent, 0.6)}`,
                }} />
                <h2 style={{
                  fontSize: 44, fontWeight: 900, color: '#fff', margin: 0,
                  letterSpacing: '-1px', textShadow: `0 0 30px ${toRgba(accent, 0.3)}`,
                }}>
                  {slide?.headline}
                </h2>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(slide?.bulletPoints || []).map((bp, i) => {
                const bulletStart = 8 + i * 6;
                const bSpring = spring({ frame, fps, config: { damping: 13, stiffness: 70 }, delay: bulletStart });
                const op = interpolate(bSpring, [0, 1], [0, 1]);
                const x = interpolate(bSpring, [0, 1], [-30, 0]);
                const isActive = frame >= bulletStart + 6 && frame < bulletStart + 40;
                return (
                  <GlassCard key={i} accent={accent} glowActive={isActive} style={{
                    opacity: op, transform: `translateX(${x}px)`,
                    padding: '16px 26px', display: 'flex', alignItems: 'center', gap: 16,
                  }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: '50%',
                      background: isActive 
                        ? `linear-gradient(135deg, ${lighten(accent, 0.1)}, ${accent})`
                        : `linear-gradient(135deg, ${accent}, ${toRgba(accent, 0.4)})`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                      boxShadow: isActive 
                        ? `0 0 20px ${toRgba(accent, 0.6)}, 0 0 40px ${toRgba(accent, 0.2)}`
                        : `0 0 12px ${toRgba(accent, 0.3)}`,
                      fontSize: 15, fontWeight: 900, color: '#fff',
                      transition: 'none',
                    }}>
                      {i + 1}
                    </div>
                    <span style={{
                      fontSize: 25, color: isActive ? '#fff' : 'rgba(255,255,255,0.85)',
                      fontWeight: 600, lineHeight: 1.3,
                      textShadow: isActive ? `0 0 10px ${toRgba(accent, 0.2)}` : 'none',
                    }}>{bp}</span>
                  </GlassCard>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ QUOTE — Cinematic with animated quotation ═══ */}
        {style === 'quote' && (
          <div style={{ textAlign: 'center', maxWidth: 1000, transform: `translateY(${titleY}px)` }}>
            {/* Animated quotation mark */}
            <div style={{
              fontSize: 160, lineHeight: 0.3, marginBottom: 20,
              background: `linear-gradient(135deg, ${lighten(accent, 0.2)}, ${accent}, ${toRgba(accent, 0.3)})`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              fontFamily: 'Georgia, serif',
              opacity: interpolate(frame, [2, 10], [0, 0.5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              transform: `scale(${interpolate(frame, [2, 12], [0.7, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })})`,
              filter: `drop-shadow(0 0 30px ${toRgba(accent, 0.5)})`,
            }}>
              "
            </div>
            <p style={{
              fontSize: 46, fontWeight: 700, color: '#fff', lineHeight: 1.3, margin: 0,
              textShadow: '0 2px 10px rgba(0,0,0,0.3)',
              opacity: interpolate(frame, [6, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              transform: `translateY(${interpolate(frame, [6, 16], [15, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`,
            }}>
              {slide?.headline}
            </p>
            {slide?.bodyText && (
              <div style={{ marginTop: 28 }}>
                <AccentLine accent={accent} frame={frame} width={60} delay={14} center />
                <p style={{
                  color: accent, fontSize: 20, marginTop: 14, fontWeight: 700,
                  letterSpacing: '2px', textTransform: 'uppercase',
                  opacity: interpolate(frame, [18, 26], [0, 1], { extrapolateRight: 'clamp' }),
                  textShadow: `0 0 20px ${toRgba(accent, 0.5)}`,
                }}>
                  {slide.bodyText}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ═══ STATS — Animated counter with glow ═══ */}
        {style === 'stats' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 180, fontWeight: 900, lineHeight: 0.85,
                background: `linear-gradient(135deg, #fff 10%, ${lighten(accent, 0.15)} 50%, ${accent} 90%)`,
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                transform: `scale(${interpolate(statsScaleSpring, [0, 1], [0.5, 1])})`,
                display: 'inline-block',
                filter: `drop-shadow(0 0 50px ${toRgba(accent, statsGlowIntensity)}) drop-shadow(0 0 100px ${toRgba(accent, statsGlowIntensity * 0.4)})`,
              }}>
                {slide?.statValue || slide?.headline}
              </div>
              <div style={{ marginTop: 30 }}>
                <AccentLine accent={accent} frame={frame} width={90} delay={10} center />
              </div>
              <p style={{
                fontSize: 36, color: 'rgba(255,255,255,0.6)', marginTop: 20,
                fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
                opacity: interpolate(frame, [14, 22], [0, 1], { extrapolateRight: 'clamp' }),
                textShadow: `0 0 20px ${toRgba(accent, 0.3)}`,
              }}>
                {slide?.statLabel || slide?.bodyText}
              </p>
            </div>
        )}

        {/* ═══ BAR CHART ═══ */}
        {style === 'bar_chart' && (
          <GlassCard accent={accent} glowActive style={{ width: '100%', maxWidth: 1100, padding: '32px 40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 4 }}>
              <div style={{
                width: 4, height: 32, borderRadius: 3,
                background: `linear-gradient(180deg, ${lighten(accent, 0.1)}, ${accent}, ${toRgba(accent, 0.3)})`,
                boxShadow: `0 0 14px ${toRgba(accent, 0.5)}`,
              }} />
              <h2 style={{ fontSize: 40, fontWeight: 900, color: '#fff', margin: 0, transform: `translateY(${titleY}px)` }}>
                {slide?.headline}
              </h2>
            </div>
            {slide?.chartData ? (
              <BarChart labels={slide.chartData.labels} values={slide.chartData.values} unit={slide.chartData.unit} accent={accent} frame={frame} fps={fps} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
                {(slide?.bulletPoints || []).map((bp, i) => {
                  const op = interpolate(frame, [8 + i * 5, 18 + i * 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: op }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent, boxShadow: `0 0 10px ${toRgba(accent, 0.6)}` }} />
                      <span style={{ fontSize: 24, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>{bp}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        )}

        {/* ═══ TRANSITION / CTA / default ═══ */}
        {(style === 'transition' || !['title', 'chapter', 'bullets', 'quote', 'stats', 'bar_chart'].includes(style)) && (
          <div style={{ textAlign: 'center', transform: `translateY(${titleY}px) scale(${titleScale})` }}>
            <h1 style={{
              fontSize: 68, fontWeight: 900, color: '#fff', letterSpacing: '-2px',
              margin: 0, whiteSpace: 'pre-line',
              textShadow: `0 0 50px ${toRgba(accent, 0.4)}, 0 0 100px ${toRgba(accent, 0.15)}, 0 2px 6px rgba(0,0,0,0.4)`,
            }}>
              {slide?.headline}
            </h1>
            <div style={{ marginTop: 22 }}>
              <AccentLine accent={accent} frame={frame} width={120} delay={4} center />
            </div>
            {slide?.bodyText && (
              <p style={{
                color: 'rgba(255,255,255,0.35)', fontSize: 22, marginTop: 20,
                fontWeight: 500, letterSpacing: '1px',
                opacity: interpolate(frame, [12, 20], [0, 1], { extrapolateRight: 'clamp' }),
              }}>
                {slide.bodyText}
              </p>
            )}
          </div>
        )}

      </AbsoluteFill>

      {/* Watermark */}
      <div style={{
        position: 'absolute', top: 30, left: 38,
        display: 'flex', alignItems: 'center', gap: 8, opacity: 0.15,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: 7,
          background: `linear-gradient(135deg, ${accent}, ${toRgba(accent, 0.5)})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 900, fontSize: 8,
          boxShadow: `0 0 10px ${toRgba(accent, 0.3)}`,
        }}>IA</div>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 10, letterSpacing: '3px', textTransform: 'uppercase' }}>IADivulger</span>
      </div>

      {/* Sources */}
      {sourceUrls && <SourceBadge urls={sourceUrls} frame={frame} />}

      {/* Subtitles */}
      <Subtitles text={scene.narrationText || ''} config={subtitleConfig} />

      {/* Audio */}
      {scene.audioUrl && scene.audioUrl.length > 4 && <Audio src={scene.audioUrl} startFrom={3} />}
    </AbsoluteFill>
  );
};
