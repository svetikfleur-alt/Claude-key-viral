import path from 'node:path';
import { generateScenarioSuite } from '../src/pipeline/scenarioSuite.js';

async function main() {
  const projectRoot = process.cwd();
  const includeVideo = process.argv.includes('--no-video') ? false : true;
  const outputRootIndex = process.argv.findIndex((arg) => arg === '--output-root');
  const outputRoot = outputRootIndex >= 0 ? process.argv[outputRootIndex + 1] : undefined;
  const resolved = outputRoot ? path.resolve(projectRoot, outputRoot) : undefined;

  const result = await generateScenarioSuite(projectRoot, {
    includeVideo,
    outputRoot: resolved,
  });

  process.stdout.write(`${JSON.stringify({
    status: 'completed',
    run_dir: path.relative(projectRoot, result.run_dir),
    manifest: path.relative(projectRoot, result.manifest_path),
    report: path.relative(projectRoot, result.report_path),
    outputs_index: path.relative(projectRoot, result.index_path),
    gallery: path.relative(projectRoot, result.gallery_path),
    assets_generated: result.assets.length,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Scenario suite failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});

