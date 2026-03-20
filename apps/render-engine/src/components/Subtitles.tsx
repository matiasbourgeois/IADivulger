// @ts-nocheck — Remotion JSX types resolve at bundle time
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { SubtitleConfig, DEFAULT_SUBTITLE_CONFIG } from '../types/schema';

interface Props {
  text: string;
  config?: SubtitleConfig;
}

// ─── Font size mapping ──────────────────────────────────────────────────────

const FONT_SIZES: Record<string, number> = {
  small: 24,
  medium: 30,
  large: 40,
};

// ─── Background styles ─────────────────────────────────────────────────────

const getBackgroundStyle = (bg: string): React.CSSProperties => {
  switch (bg) {
    case 'solid':
      return {
        background: 'rgba(0, 0, 0, 0.88)',
        borderRadius: 8,
        padding: '10px 28px',
      };
    case 'dark':
      return {
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(16px)',
        borderRadius: 14,
        padding: '14px 32px',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      };
    case 'none':
    default:
      return {
        background: 'transparent',
        padding: '10px 24px',
      };
  }
};

const toRgba = (hex: string, alpha: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

// ─── Main Subtitles Component ───────────────────────────────────────────────

export const Subtitles: React.FC<Props> = ({ text, config: userConfig }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const config = { ...DEFAULT_SUBTITLE_CONFIG, ...userConfig };

  if (!config.enabled || !text || text.trim().length === 0) return null;

  const fontSize = FONT_SIZES[config.fontSize] || 30;
  const accent = config.accentColor || '#6366f1';
  const words = text.split(/\s+/).filter(w => w.length > 0);
  
  if (words.length === 0) return null;

  // ── Timing — synced with audio (startFrom=3 frames + small buffer) ──────
  const AUDIO_DELAY_FRAMES = 5;  // audio starts at frame 3 + ~2 frame processing delay
  const textStartFrame = AUDIO_DELAY_FRAMES;
  const textEndFrame = durationInFrames - 3;
  const totalTextFrames = textEndFrame - textStartFrame;
  const framesPerWord = Math.max(2, Math.floor(totalTextFrames / words.length));

  // ── Container animation — instant fade in ─────────────────────────────
  const containerIn = interpolate(frame, [0, 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const containerOut = interpolate(frame, [durationInFrames - 5, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const containerOpacity = containerIn * containerOut;

  // ── Position config ─────────────────────────────────────────────────────
  const positionMap: Record<string, React.CSSProperties> = {
    top:    { justifyContent: 'flex-start', paddingTop: 70 },
    center: { justifyContent: 'center' },
    bottom: { justifyContent: 'flex-end', paddingBottom: 55 },
  };
  const posStyle = positionMap[config.position] || positionMap.bottom;

  // ── Render ──────────────────────────────────────────────────────────────

  if (config.style === 'sentence') {
    return (
      <AbsoluteFill style={{
        display: 'flex', alignItems: 'center',
        padding: '0 80px',
        pointerEvents: 'none',
        ...posStyle,
      }}>
        <div style={{
          opacity: containerOpacity,
          maxWidth: 1100,
          textAlign: 'center',
          ...getBackgroundStyle(config.background),
        }}>
          <p style={{
            color: '#fff',
            fontSize,
            fontWeight: 700,
            textAlign: 'center',
            lineHeight: 1.4,
            margin: 0,
            fontFamily: "'Inter', 'Outfit', system-ui, sans-serif",
            textShadow: config.background === 'none'
              ? '0 2px 10px rgba(0,0,0,0.9), 0 0 30px rgba(0,0,0,0.6)'
              : '0 1px 4px rgba(0,0,0,0.4)',
            letterSpacing: '0.3px',
          }}>
            {text}
          </p>
        </div>
      </AbsoluteFill>
    );
  }

  // ── WORD BY WORD mode ─────────────────────────────────────────────────
  const wordsPerLine = fontSize >= 40 ? 4 : fontSize >= 30 ? 5 : 6;
  const lines: string[][] = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    lines.push(words.slice(i, i + wordsPerLine));
  }

  // Which word is currently active
  const currentWordIndex = Math.floor(
    interpolate(frame, [textStartFrame, textEndFrame], [0, words.length - 0.01], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    })
  );

  // Show 2 visible lines max, scrolling as we progress
  const currentLineIndex = Math.floor(currentWordIndex / wordsPerLine);
  const visibleLineStart = Math.max(0, currentLineIndex);
  const visibleLineEnd = Math.min(lines.length, currentLineIndex + 2);

  return (
    <AbsoluteFill style={{
      display: 'flex', alignItems: 'center',
      padding: '0 70px',
      pointerEvents: 'none',
      ...posStyle,
    }}>
      <div style={{
        opacity: containerOpacity,
        maxWidth: 1100,
        width: '100%',
        ...getBackgroundStyle(config.background),
      }}>
        {lines.slice(visibleLineStart, visibleLineEnd).map((lineWords, lineIdx) => (
          <div key={`${visibleLineStart}-${lineIdx}`} style={{
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
            gap: `${Math.round(fontSize * 0.28)}px`,
            marginBottom: lineIdx < visibleLineEnd - visibleLineStart - 1 ? 6 : 0,
          }}>
            {lineWords.map((word, wordIdx) => {
              const absoluteIdx = (visibleLineStart + lineIdx) * wordsPerLine + wordIdx;
              const wordAppearFrame = textStartFrame + absoluteIdx * framesPerWord;
              
              const isActive = absoluteIdx === currentWordIndex;
              const isPast = absoluteIdx < currentWordIndex;

              // Word appear — fast 3-frame fade
              const wordOpacity = interpolate(
                frame, [wordAppearFrame, wordAppearFrame + 3],
                [0, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
              );

              const wordScale = interpolate(
                frame, [wordAppearFrame, wordAppearFrame + 3],
                [0.88, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
              );

              return (
                <span key={wordIdx} style={{
                  fontSize,
                  fontWeight: isActive ? 900 : 600,
                  color: isActive ? '#fff' : isPast ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.3)',
                  fontFamily: "'Inter', 'Outfit', system-ui, sans-serif",
                  textShadow: isActive
                    ? `0 0 20px ${toRgba(accent, 0.7)}, 0 0 40px ${toRgba(accent, 0.3)}, 0 2px 6px rgba(0,0,0,0.5)`
                    : config.background === 'none'
                    ? '0 2px 8px rgba(0,0,0,0.8), 0 0 16px rgba(0,0,0,0.5)'
                    : '0 1px 3px rgba(0,0,0,0.4)',
                  opacity: wordOpacity,
                  transform: `scale(${isActive ? 1.1 : wordScale})`,
                  display: 'inline-block',
                  letterSpacing: isActive ? '0.6px' : '0.2px',
                  borderBottom: isActive ? `2.5px solid ${accent}` : '2.5px solid transparent',
                  paddingBottom: 3,
                  transition: 'none',
                }}>
                  {word}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
