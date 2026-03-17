import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { MainVideo } from './MainVideo';
import { RenderPayload } from './types/schema';
import './style.css';

const defaultPayload: RenderPayload = {
  projectId: 'preview',
  title: 'IADivulger Preview',
  format: '16:9',
  scenes: [
    {
      sceneId: 's1',
      type: 'presentation',
      narrationText: 'Bienvenidos a IADivulger, la plataforma de videos automáticos con IA.',
      durationInSeconds: 5,
      slide: {
        headline: 'IADivulger',
        bodyText: 'Videos automáticos con IA',
        style: 'title',
        backgroundColor: '#020617',
        accentColor: '#6366f1',
      }
    }
  ]
};

export const RemotionRoot: React.FC = () => {
  const fps = 30;

  return (
    <>
      <Composition
        id="IADivulger-Landscape"
        component={MainVideo as any}
        fps={fps}
        width={1920}
        height={1080}
        calculateMetadata={({ props }) => {
          const p = ((props as any)?.payload || defaultPayload) as RenderPayload;
          const total = p.scenes.reduce((acc, s) => acc + s.durationInSeconds, 0);
          return { durationInFrames: Math.max(1, Math.floor(total * fps)) };
        }}
        defaultProps={{ payload: defaultPayload, format: '16:9' } as any}
      />
      <Composition
        id="IADivulger-Portrait"
        component={MainVideo as any}
        fps={fps}
        width={1080}
        height={1920}
        calculateMetadata={({ props }) => {
          const p = ((props as any)?.payload || defaultPayload) as RenderPayload;
          const total = p.scenes.reduce((acc, s) => acc + s.durationInSeconds, 0);
          return { durationInFrames: Math.max(1, Math.floor(total * fps)) };
        }}
        defaultProps={{ payload: { ...defaultPayload, format: '9:16' }, format: '9:16' } as any}
      />
    </>
  );
};

registerRoot(RemotionRoot);
