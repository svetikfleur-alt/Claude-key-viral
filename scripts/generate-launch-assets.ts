import { generateLaunchAssetPack } from '../src/pipeline/launchAssetPack.js';

async function main() {
  const projectRoot = process.cwd();
  const updateExamples = process.argv.includes('--update-examples');
  const result = await generateLaunchAssetPack(projectRoot, { updateExamples });
  process.stdout.write(`${JSON.stringify({
    status: 'completed',
    run_dir: result.run_dir,
    manifest: result.manifest_path,
    report: result.report_path,
    outputs_index: result.index_path,
    gallery: result.gallery_path,
    assets_generated: result.assets.length,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Launch asset pack failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});

