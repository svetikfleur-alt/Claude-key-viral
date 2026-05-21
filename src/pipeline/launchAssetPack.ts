import fs from 'node:fs/promises';
import path from 'node:path';
import { renderHtmlCard } from '../codegen/htmlCardRenderer.js';
import { renderCodeImage } from '../codegen/svgRenderer.js';
import { generateOutputGallery } from './outputGallery.js';
import type { HtmlCardInput, MediaAssetRecord, MediaPipelineRunResult, SvgTemplateInput } from '../types.js';

type ValidationRecord = {
  file: string;
  ok: boolean;
  note: string;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function makeRunId(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function validateFileNonEmpty(filePath: string): Promise<ValidationRecord> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) return { file: filePath, ok: false, note: 'empty or not a file' };
    return { file: filePath, ok: true, note: `non-empty (${stat.size} bytes)` };
  } catch (error: unknown) {
    return { file: filePath, ok: false, note: `missing (${(error as Error).message})` };
  }
}

async function validateSourceContains(filePath: string, requiredPhrases: string[]): Promise<ValidationRecord[]> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return requiredPhrases.map((phrase) => ({
      file: filePath,
      ok: text.includes(phrase),
      note: `contains "${phrase}"`,
    }));
  } catch (error: unknown) {
    return [{
      file: filePath,
      ok: false,
      note: `could not read (${(error as Error).message})`,
    }];
  }
}

function recordHtml(id: string, category: string, title: string, primary: string, secondary: string[], width: number, height: number): MediaAssetRecord {
  return {
    id,
    category,
    renderer: 'html_card',
    title,
    status: 'generated',
    primary_path: primary,
    secondary_paths: secondary,
    width,
    height,
  };
}

function recordSvg(id: string, category: string, title: string, filePath: string, width: number, height: number): MediaAssetRecord {
  return {
    id,
    category,
    renderer: 'svg_template',
    title,
    status: 'generated',
    primary_path: filePath,
    width,
    height,
  };
}

async function writeIndex(outputRoot: string, entry: unknown): Promise<string> {
  const indexPath = path.join(outputRoot, 'index.json');
  let existing: unknown[] = [];
  try {
    existing = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    if (!Array.isArray(existing)) existing = [];
  } catch {
    existing = [];
  }
  (existing as unknown[]).unshift(entry);
  await fs.writeFile(indexPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  return indexPath;
}

export async function generateLaunchAssetPack(projectRoot: string, options?: { outputRoot?: string; updateExamples?: boolean }): Promise<MediaPipelineRunResult> {
  const outputRoot = path.resolve(options?.outputRoot ?? path.join(projectRoot, 'outputs'));
  const runId = makeRunId();
  const runDir = path.join(outputRoot, 'runs', runId);

  const dirHero = path.join(runDir, 'hero-banner');
  const dirDiagram = path.join(runDir, 'pipeline-diagram');
  const dirSocial = path.join(runDir, 'social-card');
  const dirFeature = path.join(runDir, 'feature-card');
  const dirUseCase = path.join(runDir, 'use-case-card');

  await Promise.all([dirHero, dirDiagram, dirSocial, dirFeature, dirUseCase].map(ensureDir));

  const manifestPath = path.join(runDir, 'manifest.md');
  const reportPath = path.join(runDir, 'report.md');

  const assets: MediaAssetRecord[] = [];

  // A. Project hero banner (HTML/CSS card)
  const hero = await renderHtmlCard({
    template: 'project_hero_banner',
    title: 'Claude MCP Media Runner',
    subtitle: 'Local-first structured media workflows for Claude, ComfyUI, and code-rendered assets.',
    eyebrow: 'Local-first MCP media runner',
    bullets: [
      'Start with structure: layouts, templates, diagrams, overlays.',
      'Keep outputs reproducible: manifests, run folders, gallery index.',
      'Use local ComfyUI later when you actually need visual richness.',
    ],
    badges: ['No hosted server', 'No API key required', 'Deterministic outputs'],
    footer: 'Structure before randomness.',
    output_name: 'hero-banner',
  }, dirHero);
  assets.push(recordHtml('hero-banner', 'hero-banner', 'Project hero banner', hero.png_path, [hero.svg_path], hero.width, hero.height));

  // B. Pipeline architecture diagram (SVG)
  const diagram: SvgTemplateInput = {
    template: 'pipeline_diagram',
    title: 'Structured local media pipeline',
    subtitle: 'Claude Desktop → Local MCP Runner → Code renderers / Local ComfyUI → Outputs / Logs / Gallery',
    width: 1600,
    height: 900,
    output_name: 'pipeline-diagram',
  };
  const diagramResult = await renderCodeImage(diagram, dirDiagram);
  assets.push(recordSvg('pipeline-diagram', 'pipeline-diagram', 'Pipeline architecture diagram', diagramResult.file_path, diagramResult.width, diagramResult.height));

  // C. Social launch card (HTML/CSS)
  const social = await renderHtmlCard({
    template: 'social_launch_card',
    title: 'Run structured media workflows from Claude',
    subtitle: 'Code-first. Local-first. Reproducible outputs.',
    eyebrow: 'Launch card',
    bullets: [
      'Generate README banners, diagrams, and structured videos from code.',
      'Organize everything into run folders you can diff and review.',
    ],
    badges: ['Shareable', 'Readable', 'Local-first'],
    footer: 'Structure before randomness.',
    output_name: 'social-launch-card',
  }, dirSocial);
  assets.push(recordHtml('social-launch-card', 'social-card', 'Social launch card', social.png_path, [social.svg_path], social.width, social.height));

  // D. Feature card (HTML/CSS)
  const feature = await renderHtmlCard({
    template: 'feature_overview_card',
    title: 'Structured media assets, not one-off generations',
    subtitle: 'Code-rendered cards + SVG diagrams + local run folders. ComfyUI remains optional.',
    eyebrow: 'Feature overview',
    bullets: [
      'Code-rendered assets: hero banners, cards, overlays.',
      'Local ComfyUI workflows: optional richness backend.',
      'Manifests + reports: every run is inspectable.',
      'Future: video-as-code (Remotion / Motion Canvas / FFmpeg).',
    ],
    badges: ['SVG + PNG', 'Manifests', 'Local gallery'],
    footer: 'Structure before randomness.',
    output_name: 'feature-card',
  }, dirFeature);
  assets.push(recordHtml('feature-card', 'feature-card', 'Feature card', feature.png_path, [feature.svg_path], feature.width, feature.height));

  // E. Practical non-project use case (HTML/CSS)
  const useCase = await renderHtmlCard({
    template: 'use_case_card',
    title: 'Travel thumbnail with a guaranteed overlay',
    subtitle: 'Use code to lock in title, badges, and hierarchy. Swap the background later without breaking layout.',
    eyebrow: 'Practical use case',
    badges: ['Overlay-first', 'Readable at thumbnail', 'Reusable template'],
    footer: 'Works without any cloud calls or keys.',
    output_name: 'use-case-card',
  }, dirUseCase);
  assets.push(recordHtml('use-case-card', 'use-case-card', 'Practical use case reference card', useCase.png_path, [useCase.svg_path], useCase.width, useCase.height));

  const validations: ValidationRecord[] = [];
  validations.push(await validateFileNonEmpty(hero.png_path));
  validations.push(await validateFileNonEmpty(hero.svg_path));
  validations.push(await validateFileNonEmpty(diagramResult.file_path));
  validations.push(await validateFileNonEmpty(social.png_path));
  validations.push(await validateFileNonEmpty(social.svg_path));
  validations.push(await validateFileNonEmpty(feature.png_path));
  validations.push(await validateFileNonEmpty(feature.svg_path));
  validations.push(await validateFileNonEmpty(useCase.png_path));
  validations.push(await validateFileNonEmpty(useCase.svg_path));
  validations.push(...await validateSourceContains(hero.svg_path, ['Claude MCP Media Runner', 'Structure before randomness']));
  validations.push(...await validateSourceContains(social.svg_path, ['Run structured media workflows from Claude', 'Code-first. Local-first. Reproducible outputs.']));
  validations.push(...await validateSourceContains(useCase.svg_path, ['Travel thumbnail', 'guaranteed overlay']));
  validations.push(...await validateSourceContains(diagramResult.file_path, ['Local MCP Runner', 'Optional Local ComfyUI']));

  const failures = validations.filter((v) => !v.ok);
  if (failures.length > 0) {
    const summary = failures.map((f) => `${path.relative(projectRoot, f.file)}: ${f.note}`).join('; ');
    throw new Error(`Launch asset pack validation failed. Cause: ${summary}. Suggested fix: adjust templates/layout and re-run.`);
  }

  const manifestLines: string[] = [
    '# Launch asset pack manifest',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Run id: \`${runId}\``,
    '',
    '## Assets',
    '',
    '- Hero banner (HTML/CSS → SVG/PNG)',
    `  - ${path.relative(projectRoot, hero.png_path)}`,
    `  - ${path.relative(projectRoot, hero.svg_path)}`,
    '- Pipeline diagram (SVG)',
    `  - ${path.relative(projectRoot, diagramResult.file_path)}`,
    '- Social launch card (HTML/CSS → SVG/PNG)',
    `  - ${path.relative(projectRoot, social.png_path)}`,
    `  - ${path.relative(projectRoot, social.svg_path)}`,
    '- Feature card (HTML/CSS → SVG/PNG)',
    `  - ${path.relative(projectRoot, feature.png_path)}`,
    `  - ${path.relative(projectRoot, feature.svg_path)}`,
    '- Practical use case card (HTML/CSS → SVG/PNG)',
    `  - ${path.relative(projectRoot, useCase.png_path)}`,
    `  - ${path.relative(projectRoot, useCase.svg_path)}`,
    '',
    '## Quality gates',
    '',
    ...validations.map((v) => `- ${v.ok ? 'PASS' : 'FAIL'}: \`${path.relative(projectRoot, v.file)}\` - ${v.note}`),
    '',
    '## Manual review checklist',
    '',
    '- Readable at GitHub/thumbnail scale',
    '- Clear hierarchy (title > subtitle > details)',
    '- No clipping or overlap',
    '- Professional developer-tool aesthetic',
    '- No “illustrative character art” used as primary story',
  ];
  await fs.writeFile(manifestPath, `${manifestLines.join('\n')}\n`, 'utf8');

  const reportLines: string[] = [
    '# Launch asset pack report',
    '',
    '## Summary',
    '',
    'This run generates a minimal, project-relevant launch asset set using HTML/CSS cards and an SVG diagram (structure-first, local-first).',
    '',
    '## Public-launch candidates',
    '',
    `- Hero banner: \`${path.relative(projectRoot, hero.png_path)}\``,
    `- Pipeline diagram: \`${path.relative(projectRoot, diagramResult.file_path)}\``,
    `- Social card: \`${path.relative(projectRoot, social.png_path)}\``,
    `- Feature card: \`${path.relative(projectRoot, feature.png_path)}\``,
    '',
    '## Practical use case',
    '',
    `- Use-case card: \`${path.relative(projectRoot, useCase.png_path)}\``,
    '',
    '## What is still rough / deferred',
    '',
    '- Video-as-code is intentionally not the focus of this pack.',
    '- Background imagery is currently procedural; later runs can layer real photos or local generative backends under the same overlay templates.',
  ];
  await fs.writeFile(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  const indexPath = await writeIndex(outputRoot, {
    run_id: runId,
    timestamp: new Date().toISOString(),
    run_dir: runDir,
    manifest_path: manifestPath,
    report_path: reportPath,
    assets_count: assets.length,
    video_count: 0,
    status: 'completed',
    featured_assets: [
      { title: 'Hero banner', path: hero.png_path, kind: 'image' },
      { title: 'Pipeline diagram', path: diagramResult.file_path, kind: 'image' },
      { title: 'Social card', path: social.png_path, kind: 'image' },
      { title: 'Use case card', path: useCase.png_path, kind: 'image' },
    ],
  });
  const gallery = await generateOutputGallery(outputRoot);

  if (options?.updateExamples) {
    const examplesDir = path.join(projectRoot, 'examples', 'demo-assets');
    await ensureDir(examplesDir);
    await fs.writeFile(path.join(examplesDir, 'README.md'), [
      '# Demo assets',
      '',
      'Curated outputs from the launch asset pack pipeline.',
      '',
      `Latest run: \`${runId}\``,
      '',
      `- hero-banner.png`,
      `- pipeline-diagram.svg`,
      `- social-launch-card.png`,
      `- feature-card.png`,
      `- use-case-card.png`,
      '',
    ].join('\n'));
    await fs.copyFile(hero.png_path, path.join(examplesDir, 'hero-banner.png'));
    await fs.copyFile(diagramResult.file_path, path.join(examplesDir, 'pipeline-diagram.svg'));
    await fs.copyFile(social.png_path, path.join(examplesDir, 'social-launch-card.png'));
    await fs.copyFile(feature.png_path, path.join(examplesDir, 'feature-card.png'));
    await fs.copyFile(useCase.png_path, path.join(examplesDir, 'use-case-card.png'));
  }

  return {
    run_id: runId,
    run_dir: runDir,
    manifest_path: manifestPath,
    report_path: reportPath,
    index_path: indexPath,
    gallery_path: gallery.html_path,
    assets,
    skipped: [],
  };
}
