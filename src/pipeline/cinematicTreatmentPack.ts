import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeReferenceVideo } from '../reference/videoReferenceAnalyzer.js';
import { renderHtmlCard } from '../codegen/htmlCardRenderer.js';
import { renderRemotionVideo } from '../codegen/remotionRenderer.js';
import { saveSvgMarkup, saveSvgMarkupAsPng } from '../codegen/svgRenderer.js';
import type { CodegenSceneInput, MediaAssetRecord } from '../types.js';

type ShotPlanScene = {
  label: string;
  start_seconds: number;
  end_seconds: number;
  objective: string;
  visual_notes: string[];
};

type ShotPlanDocument = {
  source_video: string;
  duration_seconds: number;
  scenes: ShotPlanScene[];
};

type ReferenceMetadata = {
  width: number;
  height: number;
  duration_seconds: number;
  fps: number;
  frame_count: number;
  has_audio: boolean;
  video_codec?: string;
  audio_codec?: string;
};

type ReferenceFrame = {
  timecode_seconds: number;
  file_path: string;
};

export type CinematicTreatmentPackResult = {
  section_dir: string;
  manifest_path: string;
  report_path: string;
  assets: MediaAssetRecord[];
  summary_lines: string[];
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatSeconds(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${pad(minutes)}:${seconds.toFixed(1).padStart(4, '0')}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

async function fileToDataUrl(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  const data = await fs.readFile(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

function relative(projectRoot: string, targetPath: string): string {
  return path.relative(projectRoot, targetPath).replace(/\\/g, '/');
}

export function buildTreatmentPreviewScenes(
  shotPlan: ShotPlanDocument,
  frames: Array<{ timecode_seconds: number; data_url: string }>,
): CodegenSceneInput[] {
  return shotPlan.scenes.map((scene, index) => {
    const frame = frames[Math.min(index, frames.length - 1)];
    const notes = scene.visual_notes.slice(0, 2).join(' ');
    return {
      headline: scene.label,
      accent: `Beat ${pad(index + 1)}`,
      body: `${scene.objective} ${notes}`.trim(),
      media_data_url: frame?.data_url,
    };
  });
}

export function buildStoryboardSvg(options: {
  title: string;
  subtitle: string;
  sourceLabel: string;
  metadata: ReferenceMetadata;
  frames: Array<{ timecode_seconds: number; data_url: string }>;
  shotPlan: ShotPlanDocument;
}): string {
  const width = 1600;
  const height = 1200;
  const cards = options.shotPlan.scenes.slice(0, 4);
  const frameWidth = 660;
  const frameHeight = 250;
  const leftX = 82;
  const rightX = 860;
  const topY = 232;
  const gapY = 314;

  const frameBlocks = cards.map((scene, index) => {
    const frame = options.frames[Math.min(index, options.frames.length - 1)];
    const x = index % 2 === 0 ? leftX : rightX;
    const y = topY + Math.floor(index / 2) * gapY;
    const noteLines = scene.visual_notes.slice(0, 2);
    return `
      <g transform="translate(${x} ${y})">
        <rect width="${frameWidth}" height="${frameHeight}" rx="24" fill="#07111f" stroke="rgba(125,211,252,0.18)"/>
        <image href="${frame?.data_url ?? ''}" x="22" y="22" width="292" height="164" preserveAspectRatio="xMidYMid slice" clip-path="url(#frameClip${index})"/>
        <rect x="22" y="22" width="292" height="164" rx="18" fill="none" stroke="rgba(255,255,255,0.08)"/>
        <text x="340" y="54" fill="#7dd3fc" font-size="15" font-family="Segoe UI, Arial, sans-serif" letter-spacing="1.8">SHOT ${pad(index + 1)}</text>
        <text x="340" y="88" fill="#f8fafc" font-size="28" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${esc(scene.label)}</text>
        <text x="340" y="120" fill="#9bb0ca" font-size="17" font-family="Segoe UI, Arial, sans-serif">${esc(`${formatSeconds(scene.start_seconds)} → ${formatSeconds(scene.end_seconds)}`)}</text>
        <text x="340" y="154" fill="#d8e3f2" font-size="20" font-family="Segoe UI, Arial, sans-serif">${esc(scene.objective)}</text>
        <text x="340" y="190" fill="#9eb4cf" font-size="17" font-family="Segoe UI, Arial, sans-serif">${esc(noteLines[0] ?? '')}</text>
        <text x="340" y="218" fill="#9eb4cf" font-size="17" font-family="Segoe UI, Arial, sans-serif">${esc(noteLines[1] ?? '')}</text>
      </g>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07101c"/>
      <stop offset="45%" stop-color="#0d1828"/>
      <stop offset="100%" stop-color="#132437"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
    ${cards.map((_, index) => `
      <clipPath id="frameClip${index}">
        <rect x="22" y="22" width="292" height="164" rx="18"/>
      </clipPath>
    `).join('\n')}
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="180" cy="160" r="210" fill="rgba(125,211,252,0.16)" filter="url(#glow)"/>
  <circle cx="1440" cy="1040" r="250" fill="rgba(96,165,250,0.12)" filter="url(#glow)"/>
  <rect x="34" y="34" width="${width - 68}" height="${height - 68}" rx="30" fill="none" stroke="rgba(125,211,252,0.12)"/>
  <text x="84" y="106" fill="#7dd3fc" font-size="18" font-family="Segoe UI, Arial, sans-serif" letter-spacing="2.3">REFERENCE-DRIVEN CINEMATIC TREATMENT</text>
  <text x="84" y="160" fill="#f8fafc" font-size="58" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${esc(options.title)}</text>
  <text x="84" y="204" fill="#bfd0e4" font-size="24" font-family="Segoe UI, Arial, sans-serif">${esc(options.subtitle)}</text>

  <rect x="84" y="1052" width="1432" height="90" rx="22" fill="rgba(7,17,31,0.72)" stroke="rgba(125,211,252,0.12)"/>
  <text x="116" y="1090" fill="#f8fafc" font-size="24" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${esc(options.sourceLabel)}</text>
  <text x="116" y="1122" fill="#9db3cf" font-size="18" font-family="Segoe UI, Arial, sans-serif">${esc(`${options.metadata.width}x${options.metadata.height} • ${options.metadata.fps} fps • ${options.metadata.duration_seconds}s • ${options.metadata.video_codec ?? 'video'}`)}</text>
  <text x="920" y="1090" fill="#f8fafc" font-size="24" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Direction</text>
  <text x="920" y="1122" fill="#9db3cf" font-size="18" font-family="Segoe UI, Arial, sans-serif">Environment first. Single clear action. Premium composition. Minimal overlays.</text>

  ${frameBlocks}
</svg>`;
}

async function copyAnalysisIntoDir(
  analysis: Awaited<ReturnType<typeof analyzeReferenceVideo>>,
  destinationDir: string,
): Promise<{ metadataPath: string; styleBriefPath: string; shotPlanPath: string; notesPath: string; frames: ReferenceFrame[] }> {
  await ensureDir(destinationDir);
  const metadataPath = path.join(destinationDir, path.basename(analysis.metadata_path));
  const styleBriefPath = path.join(destinationDir, path.basename(analysis.style_brief_path));
  const shotPlanPath = path.join(destinationDir, path.basename(analysis.shot_plan_path));
  const notesPath = path.join(destinationDir, path.basename(analysis.notes_path));
  await fs.copyFile(analysis.metadata_path, metadataPath);
  await fs.copyFile(analysis.style_brief_path, styleBriefPath);
  await fs.copyFile(analysis.shot_plan_path, shotPlanPath);
  await fs.copyFile(analysis.notes_path, notesPath);

  const framesDir = path.join(destinationDir, 'frames');
  await ensureDir(framesDir);
  const copiedFrames: ReferenceFrame[] = [];
  for (const frame of analysis.frames) {
    const framePath = path.join(framesDir, path.basename(frame.file_path));
    await fs.copyFile(frame.file_path, framePath);
    copiedFrames.push({ timecode_seconds: frame.timecode_seconds, file_path: framePath });
  }

  return { metadataPath, styleBriefPath, shotPlanPath, notesPath, frames: copiedFrames };
}

function assetRecord(
  id: string,
  category: string,
  renderer: MediaAssetRecord['renderer'],
  title: string,
  primaryPath: string,
  secondaryPaths?: string[],
): MediaAssetRecord {
  return {
    id,
    category,
    renderer,
    title,
    status: 'generated',
    primary_path: primaryPath,
    secondary_paths: secondaryPaths,
  };
}

export async function generateCinematicTreatmentPack(options: {
  projectRoot: string;
  runDir: string;
  referenceVideoPath: string;
  notes?: string;
}): Promise<CinematicTreatmentPackResult> {
  const sectionDir = path.join(options.runDir, '06_cinematic-treatment');
  const refDir = path.join(sectionDir, '01_reference-study');
  const boardDir = path.join(sectionDir, '02_storyboards');
  const previewDir = path.join(sectionDir, '03_preview-video');
  const manifestPath = path.join(sectionDir, '00_treatment-manifest.md');
  const reportPath = path.join(sectionDir, '99_treatment-report.md');

  await ensureDir(refDir);
  await ensureDir(boardDir);
  await ensureDir(previewDir);

  const analysis = await analyzeReferenceVideo({
    projectRoot: options.projectRoot,
    videoPath: options.referenceVideoPath,
    notes: options.notes,
  });

  const copied = await copyAnalysisIntoDir(analysis, refDir);
  const shotPlan = await readJsonFile<ShotPlanDocument>(copied.shotPlanPath);
  const frameData = await Promise.all(copied.frames.map(async (frame) => ({
    timecode_seconds: frame.timecode_seconds,
    file_path: frame.file_path,
    data_url: await fileToDataUrl(frame.file_path),
  })));

  const sourceBase = path.basename(options.referenceVideoPath);
  const cover = await renderHtmlCard({
    template: 'feature_overview_card',
    title: 'Cinematic treatment pack',
    subtitle: 'Reference-driven shot planning for precise local media work. Study first, then render with the right backend.',
    eyebrow: 'Professional motion direction',
    bullets: [
      'Real reference frames are extracted and organized into a reusable local study packet.',
      'Shot structure stays explicit: objective, timing, and visual notes per beat.',
      'Code-first stills, storyboards, and previews stay inspectable alongside optional ComfyUI work.',
    ],
    badges: ['Reference study', 'Shot plan', 'Preview video', 'Local-first'],
    footer: `Source reference: ${sourceBase}`,
    output_name: 'cinematic-treatment-cover',
  }, boardDir);

  const storyboardSvg = buildStoryboardSvg({
    title: 'Cinematic shot board',
    subtitle: 'Reference frames + timing + intent in one inspectable layout.',
    sourceLabel: sourceBase,
    metadata: analysis.metadata,
    frames: frameData,
    shotPlan,
  });
  const storyboardSvgResult = await saveSvgMarkup({
    svg_markup: storyboardSvg,
    output_name: 'cinematic-shot-board',
  }, boardDir);
  const storyboardPngResult = await saveSvgMarkupAsPng({
    svg_markup: storyboardSvg,
    output_name: 'cinematic-shot-board',
  }, boardDir);

  const previewScenes = buildTreatmentPreviewScenes(shotPlan, frameData);
  const previewVideo = await renderRemotionVideo({
    title: 'Cinematic treatment preview',
    subtitle: 'Reference-led motion language for professional local media outputs.',
    theme: 'ocean',
    visual_style: 'cinematic_treatment',
    scenes: previewScenes,
    width: 1280,
    height: 720,
    fps: Math.min(30, Math.max(24, Math.round(analysis.metadata.fps))),
    duration_seconds: Math.max(10, Math.min(22, shotPlan.scenes.length * 3.5)),
    output_name: 'cinematic-treatment-preview',
  }, previewDir);

  const assets: MediaAssetRecord[] = [
    assetRecord('cinematic-treatment-metadata', 'cinematic-treatment', 'reference_study', 'Reference metadata', copied.metadataPath),
    assetRecord('cinematic-treatment-style-brief', 'cinematic-treatment', 'reference_study', 'Reference style brief', copied.styleBriefPath),
    assetRecord('cinematic-treatment-shot-plan', 'cinematic-treatment', 'reference_study', 'Reference shot plan', copied.shotPlanPath),
    assetRecord('cinematic-treatment-cover', 'cinematic-treatment', 'html_card', 'Cinematic treatment cover card', cover.png_path, [cover.svg_path]),
    assetRecord('cinematic-treatment-board', 'cinematic-treatment', 'svg_template', 'Cinematic shot board', storyboardPngResult.file_path, [storyboardSvgResult.file_path]),
    assetRecord('cinematic-treatment-preview', 'cinematic-treatment', 'remotion_video', 'Cinematic treatment preview video', previewVideo.file_path),
  ];

  const summaryLines = [
    `Reference video: \`${relative(options.projectRoot, options.referenceVideoPath)}\``,
    `Resolution: ${analysis.metadata.width}x${analysis.metadata.height}`,
    `Frame rate: ${analysis.metadata.fps} fps`,
    `Duration: ${analysis.metadata.duration_seconds}s`,
    'Direction: environment-first composition, one dominant action per beat, minimal overlays during motion.',
  ];

  const manifestLines = [
    '# Cinematic treatment manifest',
    '',
    ...summaryLines.map((line) => `- ${line}`),
    '',
    '## Generated assets',
    '',
    ...assets.map((asset) => `- ${asset.title} -> \`${relative(options.projectRoot, asset.primary_path)}\`${asset.secondary_paths?.length ? ` plus ${asset.secondary_paths.map((file) => `\`${relative(options.projectRoot, file)}\``).join(', ')}` : ''}`),
    '',
    '## Why this exists',
    '',
    '- It turns a strong reference into an inspectable packet instead of asking the renderer to guess.',
    '- It keeps cinematic intent explicit before handing the job to optional richer backends.',
    '- It gives the local code-first pipeline a professional planning layer instead of toy illustration filler.',
  ];
  await fs.writeFile(manifestPath, `${manifestLines.join('\n')}\n`, 'utf8');

  const reportLines = [
    '# Cinematic treatment report',
    '',
    '## Summary',
    '',
    'This treatment pack improves the project in the right direction: better shot planning, clearer visual intent, and a stronger bridge between code-first precision and richer cinematic generation.',
    '',
    '## What looks good',
    '',
    '- The treatment cover card explains the purpose cleanly.',
    '- The shot board combines real reference frames with timing and intent in one page.',
    '- The preview video reads more like editorial motion direction than a generic presentation deck.',
    '',
    '## What is still limited',
    '',
    '- The preview video is still a treatment layer, not final photoreal generation.',
    '- Rich ComfyUI or other generative backends are still needed when the goal is true cinematic footage, not planning and structure.',
    '',
    '## Recommended next move',
    '',
    '- Use this shot plan and frame language to drive a tuned local ComfyUI or future BYOK cinematic backend, then compare final output back against the treatment board.',
  ];
  await fs.writeFile(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  return {
    section_dir: sectionDir,
    manifest_path: manifestPath,
    report_path: reportPath,
    assets,
    summary_lines: summaryLines,
  };
}
