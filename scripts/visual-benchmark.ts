import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateVisualBenchmark } from '../src/pipeline/visualBenchmark.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const includeVideo = !process.argv.includes('--no-video');
  const result = await generateVisualBenchmark(projectRoot, { includeVideo });
  process.stdout.write(`${JSON.stringify({
    status: 'completed',
    run_dir: path.relative(projectRoot, result.run_dir).replace(/\\/g, '/'),
    manifest: path.relative(projectRoot, result.manifest_path).replace(/\\/g, '/'),
    report: path.relative(projectRoot, result.report_path).replace(/\\/g, '/'),
    gallery: path.relative(projectRoot, result.gallery_path).replace(/\\/g, '/'),
    assets_generated: result.assets.length,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Visual benchmark failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});

