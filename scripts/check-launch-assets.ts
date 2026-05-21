import fs from 'node:fs/promises';
import path from 'node:path';

async function fileExistsNonEmpty(filePath: string) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`File missing/empty: ${filePath}`);
}

async function containsAll(filePath: string, phrases: string[]) {
  const text = await fs.readFile(filePath, 'utf8');
  for (const phrase of phrases) {
    if (!text.includes(phrase)) throw new Error(`Missing phrase "${phrase}" in ${filePath}`);
  }
}

async function main() {
  const projectRoot = process.cwd();
  const runDirArg = process.argv[2];
  if (!runDirArg) {
    process.stderr.write('Usage: npm run media:check-launch -- <run_dir>\n');
    process.exitCode = 2;
    return;
  }
  const runDir = path.isAbsolute(runDirArg) ? runDirArg : path.resolve(projectRoot, runDirArg);

  const manifest = path.join(runDir, 'manifest.md');
  const report = path.join(runDir, 'report.md');

  const heroPng = path.join(runDir, 'hero-banner', 'hero-banner.png');
  const heroSvg = path.join(runDir, 'hero-banner', 'hero-banner.svg');
  const diagramSvg = path.join(runDir, 'pipeline-diagram', 'pipeline-diagram.svg');
  const socialPng = path.join(runDir, 'social-card', 'social-launch-card.png');
  const socialSvg = path.join(runDir, 'social-card', 'social-launch-card.svg');
  const featurePng = path.join(runDir, 'feature-card', 'feature-card.png');
  const featureSvg = path.join(runDir, 'feature-card', 'feature-card.svg');
  const usePng = path.join(runDir, 'use-case-card', 'use-case-card.png');
  const useSvg = path.join(runDir, 'use-case-card', 'use-case-card.svg');

  await fileExistsNonEmpty(manifest);
  await fileExistsNonEmpty(report);
  await fileExistsNonEmpty(heroPng);
  await fileExistsNonEmpty(heroSvg);
  await fileExistsNonEmpty(diagramSvg);
  await fileExistsNonEmpty(socialPng);
  await fileExistsNonEmpty(socialSvg);
  await fileExistsNonEmpty(featurePng);
  await fileExistsNonEmpty(featureSvg);
  await fileExistsNonEmpty(usePng);
  await fileExistsNonEmpty(useSvg);

  await containsAll(heroSvg, ['Claude MCP Media Runner', 'Structure before randomness']);
  await containsAll(socialSvg, ['Run structured media workflows from Claude', 'Code-first. Local-first. Reproducible outputs.']);
  await containsAll(diagramSvg, ['Local MCP Runner', 'Optional Local ComfyUI']);
  await containsAll(useSvg, ['Travel thumbnail', 'guaranteed overlay']);

  process.stdout.write(JSON.stringify({
    status: 'ok',
    run_dir: runDir,
    checked_files: 11,
    note: 'All required launch assets exist, are non-empty, and contain required phrases.',
  }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`Launch asset check failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
