// @ts-nocheck — Remotion 4 types resolve at bundle time via Remotion's own bundler
import React from 'react';
import { Series } from 'remotion';
import { PresentationSlide } from './components/PresentationSlide';
import { VideoScene } from './components/VideoScene';
import { ImageScene } from './components/ImageScene';

export const MainVideo: React.FC<{ payload: any; format: any }> = ({ payload, format }) => {
  const fps = 30;

  // Safety: if payload or scenes are missing, show error slide
  if (!payload?.scenes?.length) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#1a0000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#f87171', fontSize: 36, fontFamily: 'sans-serif' }}>Error: no scenes in payload</p>
      </div>
    );
  }

  return (
    <Series>
      {payload.scenes.map((scene: any, index: number) => {
        const dur = Math.max(30, Math.floor((scene.durationInSeconds || 5) * fps));
        return (
          <Series.Sequence key={`${scene.sceneId || index}`} durationInFrames={dur}>
            {scene.type === 'presentation'
              ? <PresentationSlide scene={scene} />
              : scene.type === 'image'
              ? <ImageScene scene={scene} />
              : <VideoScene scene={scene} format={format || '16:9'} />
            }
          </Series.Sequence>
        );
      })}
    </Series>
  );
};
