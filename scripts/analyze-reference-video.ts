import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeReferenceVideo } from '../src/reference/videoReferenceAnalyzer.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const videoPath = process.argv[2];
  const notes = process.argv.slice(3).join(' ').trim() || undefined;

  if (!videoPath) {
    throw new Error('Usage: npm run analyze:reference -- <video_path> [notes]');
  }

  const result = await analyzeReferenceVideo({
    projectRoot,
    videoPath,
    notes,
  });

  console.log(JSON.stringify({
    status: 'completed',
    output_dir: path.relative(projectRoot, result.output_dir).replace(/\\/g, '/'),
    metadata_path: path.relative(projectRoot, result.metadata_path).replace(/\\/g, '/'),
    style_brief_path: path.relative(projectRoot, result.style_brief_path).replace(/\\/g, '/'),
    shot_plan_path: path.relative(projectRoot, result.shot_plan_path).replace(/\\/g, '/'),
    notes_path: path.relative(projectRoot, result.notes_path).replace(/\\/g, '/'),
    frames: result.frames.map((frame) => ({
      timecode_seconds: frame.timecode_seconds,
      file_path: path.relative(projectRoot, frame.file_path).replace(/\\/g, '/'),
    })),
    metadata: result.metadata,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
