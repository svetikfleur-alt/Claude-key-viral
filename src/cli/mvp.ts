import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { runMvp } from '../pipeline/mvpRun.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function canSpawnChildProcess(): boolean {
  // In some Windows sandbox environments, Node's child_process.spawn is blocked (EPERM).
  // We use this to decide whether video rendering paths are likely to work.
  try {
    const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    return !result.error;
  } catch {
    return false;
  }
}

async function main() {
  const explicitVideo = hasArg('--video');
  const explicitNoVideo = hasArg('--no-video');
  const includeVideo = explicitNoVideo
    ? false
    : explicitVideo
      ? true
      : canSpawnChildProcess();

  const result = await runMvp(projectRoot, { includeVideo });
  process.stdout.write(`${JSON.stringify({
    status: 'completed',
    include_video: includeVideo,
    mvp_run_dir: path.relative(projectRoot, result.mvp_run_dir).replace(/\\/g, '/'),
    comfyui_health: result.comfyui_health,
    comfyui_passthrough: result.comfyui_passthrough,
    comfyui_real_image: result.comfyui_real_image,
    hybrid_comfy_pack: result.hybrid_comfy_pack ? {
      run_dir: path.relative(projectRoot, result.hybrid_comfy_pack.run_dir).replace(/\\/g, '/'),
      report: path.relative(projectRoot, result.hybrid_comfy_pack.report_path).replace(/\\/g, '/'),
    } : undefined,
    intro_video_pro: result.intro_video_pro ? {
      file: path.relative(projectRoot, result.intro_video_pro.file_path).replace(/\\/g, '/'),
      duration_seconds: result.intro_video_pro.duration_seconds,
      width: result.intro_video_pro.width,
      height: result.intro_video_pro.height,
      fps: result.intro_video_pro.fps,
    } : undefined,
    notes: result.notes,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`MVP run failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
