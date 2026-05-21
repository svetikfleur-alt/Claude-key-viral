import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDemoAssetPack } from '../src/pipeline/demoAssetPack.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const referenceVideoPath = process.argv[2];
  const referenceNotes = process.argv[3];
  const result = await generateDemoAssetPack(projectRoot, referenceVideoPath ? {
    referenceVideoPath,
    referenceNotes,
  } : {});
  const readmeReady = result.assets
    .filter((asset) => asset.id === 'hero-banner' || asset.id === 'pipeline-diagram' || asset.id === 'social-launch-card')
    .map((asset) => path.relative(projectRoot, asset.primary_path).replace(/\\/g, '/'));
  const cinematicAssets = result.assets
    .filter((asset) => asset.category === 'cinematic-treatment')
    .map((asset) => path.relative(projectRoot, asset.primary_path).replace(/\\/g, '/'));

  console.log(JSON.stringify({
    status: 'completed',
    run_dir: path.relative(projectRoot, result.run_dir).replace(/\\/g, '/'),
    manifest: path.relative(projectRoot, result.manifest_path).replace(/\\/g, '/'),
    report: path.relative(projectRoot, result.report_path).replace(/\\/g, '/'),
    outputs_index: path.relative(projectRoot, result.index_path).replace(/\\/g, '/'),
    gallery: path.relative(projectRoot, result.gallery_path).replace(/\\/g, '/'),
    assets_generated: result.assets.length,
    readme_ready_assets: readmeReady,
    cinematic_assets: cinematicAssets,
    skipped: result.skipped,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
