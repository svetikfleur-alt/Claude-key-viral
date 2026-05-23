import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMvp } from '../src/pipeline/mvpRun.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const includeVideo = !process.argv.includes('--no-video');
  const result = await runMvp(projectRoot, { includeVideo });
  process.stdout.write(`${JSON.stringify({
    status: 'completed',
    mvp_run_dir: path.relative(projectRoot, result.mvp_run_dir).replace(/\\/g, '/'),
    comfyui_health: result.comfyui_health,
    comfyui_passthrough: result.comfyui_passthrough,
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
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`MVP run failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
