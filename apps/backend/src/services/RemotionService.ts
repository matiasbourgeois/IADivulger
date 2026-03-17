import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs';
import { ProjectPayload } from '../types/job.types';

export class RemotionService {
  private static transformPayloadForRemotion(payload: ProjectPayload) {
    return {
      projectId: payload.projectId,
      title: payload.title,
      description: payload.description,
      format: (payload.formats && payload.formats.includes('9:16') ? '9:16' : '16:9') as '16:9' | '9:16',
      scenes: payload.script.scenes.map(s => ({
        sceneId: s.sceneId,
        type: s.type || 'video',
        narrationText: s.narration,
        assetUrl: s.assetUrl || '',
        audioUrl: s.audioUrl || '',
        durationInSeconds: s.durationSeconds,
        slide: s.slide,
      }))
    };
  }

  static async renderVideo(payload: ProjectPayload): Promise<string> {
    console.log(`[RemotionService] Starting render for project: ${payload.title}`);

    const transformedPayload = this.transformPayloadForRemotion(payload);
    const format = transformedPayload.format;
    const compositionId = format === '9:16' ? 'IADivulger-Portrait' : 'IADivulger-Landscape';

    // ── APPROACH: Generate a Root file with the actual payload baked in ──────
    // Remotion 4.0.0 does NOT inject inputProps into the component when no
    // schema is defined. calculateMetadata CAN read inputProps (runs in Node)
    // but the Chromium component render only sees defaultProps.
    // Solution: bake the payload as the defaultPayload in a generated entry file.
    // ─────────────────────────────────────────────────────────────────────────

    const renderEngineDir = path.resolve(__dirname, '../../../../apps/render-engine/src');
    const generatedEntryPath = path.join(renderEngineDir, `_generated_root_${Date.now()}.tsx`);

    const totalFrames = transformedPayload.scenes.reduce(
      (acc, s) => acc + Math.max(30, Math.floor((s.durationInSeconds || 5) * 30)),
      0
    );

    const payloadJSON = JSON.stringify(transformedPayload, null, 2)
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\${/g, '\\${');

    const generatedRoot = `
// AUTO-GENERATED — DO NOT EDIT — will be deleted after render
// @ts-nocheck
import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { MainVideo } from './MainVideo';
import './style.css';

const PAYLOAD = ${JSON.stringify(transformedPayload)};

export const RemotionRoot = () => (
  <>
    <Composition
      id="${compositionId}"
      component={MainVideo}
      fps={30}
      width={${format === '9:16' ? 1080 : 1920}}
      height={${format === '9:16' ? 1920 : 1080}}
      durationInFrames={${totalFrames}}
      defaultProps={{ payload: PAYLOAD, format: '${format}' }}
    />
  </>
);

registerRoot(RemotionRoot);
`;

    fs.writeFileSync(generatedEntryPath, generatedRoot, 'utf-8');
    console.log(`[RemotionService] Generated entry: ${generatedEntryPath}`);
    console.log(`[RemotionService] Payload has ${transformedPayload.scenes.length} scenes, ${totalFrames} frames total`);

    try {
      // Bundle from the generated file
      console.log(`[RemotionService] Bundling...`);
      const bundleLocation = await bundle({ entryPoint: generatedEntryPath });

      // Select composition (no inputProps needed — payload is in defaultProps)
      const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: compositionId,
      });

      console.log(`[RemotionService] Composition: ${composition.id}, ${composition.durationInFrames} frames`);

      // Output
      const outputDir = path.resolve(__dirname, '../../public/outputs');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const timestamp = Date.now();
      const filename = `final_${payload.projectId}_${timestamp}.mp4`;
      const outputLocation = path.join(outputDir, filename);

      console.log(`[RemotionService] Rendering → ${outputLocation}`);
      await renderMedia({
        composition,
        serveUrl: bundleLocation,
        codec: 'h264',
        outputLocation,
        onProgress: ({ progress }) => {
          if (Math.round(progress * 100) % 10 === 0) {
            console.log(`[RemotionService] Progress: ${Math.round(progress * 100)}%`);
          }
        },
      });

      console.log(`[RemotionService] ✅ Render complete → ${filename}`);
      return `http://localhost:3001/outputs/${filename}`;

    } finally {
      // Always clean up the generated file
      if (fs.existsSync(generatedEntryPath)) {
        fs.unlinkSync(generatedEntryPath);
        console.log(`[RemotionService] Cleaned up generated entry file`);
      }
    }
  }
}
