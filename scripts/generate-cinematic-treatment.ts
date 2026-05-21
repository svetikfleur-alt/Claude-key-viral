import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCinematicTreatmentPack } from '../src/pipeline/cinematicTreatmentPack.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const videoPath = process.argv[2];
  const notes = process.argv[3];
  if (!videoPath) {
    throw new Error('Usage: npm run media:treatment -- "C:/path/to/reference.mp4" "optional notes"');
  }

  const now = new Date();
  const runDir = path.join(
    projectRoot,
    'outputs',
    'runs',
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`,
  );

  const result = await generateCinematicTreatmentPack({
    projectRoot,
    runDir,
    referenceVideoPath: videoPath,
    notes,
  });

  console.log(JSON.stringify({
    status: 'completed',
    section_dir: path.relative(projectRoot, result.section_dir).replace(/\\/g, '/'),
    manifest: path.relative(projectRoot, result.manifest_path).replace(/\\/g, '/'),
    report: path.relative(projectRoot, result.report_path).replace(/\\/g, '/'),
    assets_generated: result.assets.length,
    summary: result.summary_lines,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
