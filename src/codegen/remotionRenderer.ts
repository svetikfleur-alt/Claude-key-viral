import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { RemotionVideoInput } from '../types.js';
import { sanitizeFileStem } from './svgRenderer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const remotionEntryCandidates = [
  path.resolve(projectRoot, 'dist', 'codegen', 'remotionEntry.js'),
  path.resolve(projectRoot, 'src', 'codegen', 'remotionEntry.ts'),
];

async function resolveRemotionEntry(): Promise<string> {
  for (const candidate of remotionEntryCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep trying candidates
    }
  }

  throw new Error(`Unable to locate the Remotion entry point. Looked for: ${remotionEntryCandidates.join(', ')}`);
}

export interface RenderRemotionVideoResult {
  status: 'ok';
  file_path: string;
  width: number;
  height: number;
  fps: number;
  duration_seconds: number;
  warnings: string[];
}

function normalizeVideoInput(input: RemotionVideoInput): Required<Pick<RemotionVideoInput, 'title'>> & RemotionVideoInput {
  return {
    title: input.title,
    subtitle: input.subtitle,
    theme: input.theme ?? 'slate',
    visual_style: input.visual_style ?? 'presentation',
    scenes: input.scenes?.length ? input.scenes : undefined,
    width: input.width ?? 1280,
    height: input.height ?? 720,
    fps: input.fps ?? 30,
    duration_seconds: input.duration_seconds ?? 6,
    output_name: input.output_name,
  };
}

function toInputProps(input: Required<Pick<RemotionVideoInput, 'title'>> & RemotionVideoInput): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

export async function renderRemotionVideo(input: RemotionVideoInput, outputDir: string): Promise<RenderRemotionVideoResult> {
  const normalized = normalizeVideoInput(input);
  const inputProps = toInputProps(normalized);
  const outputName = sanitizeFileStem(normalized.output_name ?? `${normalized.title}-${Date.now()}`);
  const outputPath = path.resolve(outputDir, `${outputName}.mp4`);
  await fs.mkdir(outputDir, { recursive: true });

  const bundleDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comfyui-mcp-remotion-'));
  try {
    const entryPoint = await resolveRemotionEntry();
    const bundled = await bundle({
      entryPoint,
      outDir: bundleDir,
      enableCaching: true,
      publicPath: null,
      onProgress: () => undefined,
      onDirectoryCreated: () => undefined,
      onPublicDirCopyProgress: () => undefined,
      onSymlinkDetected: () => undefined,
      ignoreRegisterRootWarning: true,
      keyboardShortcutsEnabled: false,
      askAIEnabled: false,
      maxTimelineTracks: null,
      bufferStateDelayInMilliseconds: null,
      audioLatencyHint: null,
      experimentalClientSideRenderingEnabled: false,
      renderDefaults: null,
      rootDir: null,
      publicDir: null,
      rspack: false,
      gitSource: null,
      symlinkPublicDir: false,
    });

    const composition = await selectComposition({
      serveUrl: bundled,
      id: 'CodegenVideo',
      inputProps,
      chromiumOptions: {
        gl: 'angle',
      },
      logLevel: 'error',
    });

    await renderMedia({
      serveUrl: bundled,
      composition,
      codec: 'h264',
      outputLocation: outputPath,
      overwrite: true,
      inputProps,
      chromiumOptions: {
        gl: 'angle',
      },
      muted: true,
      logLevel: 'error',
    });

    return {
      status: 'ok',
      file_path: outputPath,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      duration_seconds: Number((composition.durationInFrames / composition.fps).toFixed(3)),
      warnings: [],
    };
  } finally {
    await fs.rm(bundleDir, { recursive: true, force: true });
  }
}
