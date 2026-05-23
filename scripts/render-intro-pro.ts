import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRemotionVideo } from '../src/codegen/remotionRenderer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function stamp(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

async function main() {
  const runId = stamp();
  const outDir = path.join(projectRoot, 'outputs', 'runs', runId, 'video-pro');
  // Audio assets are user-provided in public/audio/. If missing, we render silently.
  const musicPath = path.join(projectRoot, 'public', 'audio', 'music-bed.mp3');
  const voicePath = path.join(projectRoot, 'public', 'audio', 'voiceover.wav');
  const fs = await import('node:fs/promises');
  const hasMusic = await fs.access(musicPath).then(() => true).catch(() => false);
  const hasVoice = await fs.access(voicePath).then(() => true).catch(() => false);
  const result = await renderRemotionVideo({
    title: 'Claude MCP Media Runner',
    subtitle: 'Code-first structured media + optional local ComfyUI backgrounds.',
    theme: 'slate',
    visual_style: 'pipeline_intro_pro',
    width: 1920,
    height: 1080,
    fps: 30,
    duration_seconds: 45,
    output_name: 'pipeline-intro-pro-1080p',
    music_src: hasMusic ? 'audio/music-bed.mp3' : undefined,
    voiceover_src: hasVoice ? 'audio/voiceover.wav' : undefined,
    music_volume: 0.18,
    voiceover_volume: 1.0,
    scenes: [],
  }, outDir);

  process.stdout.write(`${JSON.stringify({
    status: 'completed',
    run_dir: path.relative(projectRoot, outDir).replace(/\\/g, '/'),
    file: path.relative(projectRoot, result.file_path).replace(/\\/g, '/'),
    duration_seconds: result.duration_seconds,
    width: result.width,
    height: result.height,
    fps: result.fps,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`render failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
