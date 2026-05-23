import fs from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from '../config.js';
import { ComfyUiClient } from '../comfyuiClient.js';
import { ensureLogFiles, writeRunLog } from '../logger.js';
import { loadWorkflow } from '../workflowStore.js';
import { patchWorkflowForRun } from '../workflowPatcher.js';
import { detectOutputsFromHistory } from '../outputDetector.js';
import { safeCopyFileIntoDir } from '../comfyuiPaths.js';
import { renderSvgScene } from '../codegen/sceneDslRenderer.js';
import type { MediaAssetRecord, MediaPipelineRunResult, SvgSceneSpec } from '../types.js';

type HybridPackResult = MediaPipelineRunResult & {
  comfyui_url?: string;
  comfyui_background_output?: string;
  comfyui_background_resolved?: string;
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

async function findBestReferenceFrame(projectRoot: string): Promise<string | undefined> {
  const base = path.join(projectRoot, 'outputs', 'reference-studies');
  try {
    const studies = await fs.readdir(base, { withFileTypes: true });
    let best: { file: string; size: number } | undefined;
    for (const study of studies) {
      if (!study.isDirectory()) continue;
      const framesDir = path.join(base, study.name, '01_frames');
      let files: string[] = [];
      try {
        files = (await fs.readdir(framesDir)).filter((name) => name.toLowerCase().endsWith('.png'));
      } catch {
        files = [];
      }
      for (const file of files) {
        const full = path.join(framesDir, file);
        try {
          const stat = await fs.stat(full);
          if (!best || stat.size > best.size) best = { file: full, size: stat.size };
        } catch {
          // ignore
        }
      }
    }
    return best?.file;
  } catch {
    return undefined;
  }
}

async function fileToDataUrlPng(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function overlayScene(opts: { width: number; height: number; title: string; subtitle: string; eyebrow: string; backgroundDataUrl: string }): SvgSceneSpec {
  const { width, height } = opts;
  return {
    width,
    height,
    background: '#050b16',
    defs: {
      gradients: [
        {
          id: 'shade',
          type: 'linear',
          x1: '0%',
          y1: '0%',
          x2: '0%',
          y2: '100%',
          stops: [
            { offset: '0%', color: '#020617', opacity: 0.12 },
            { offset: '55%', color: '#020617', opacity: 0.48 },
            { offset: '100%', color: '#020617', opacity: 0.82 },
          ],
        },
      ],
      filters: [
        { id: 'shadow', type: 'drop_shadow', dx: 0, dy: 18, std_deviation: 26, color: '#020617', opacity: 0.58 },
      ],
    },
    nodes: [
      { kind: 'image', x: 0, y: 0, width, height, href: opts.backgroundDataUrl, preserve_aspect: 'cover' },
      { kind: 'rect', x: 0, y: 0, width, height, fill: 'url(#shade)' },
      { kind: 'rect', x: 56, y: 56, width: width - 112, height: height - 112, radius: 36, stroke: 'rgba(125,211,252,0.12)', fill: 'rgba(0,0,0,0)' },
      {
        kind: 'group',
        x: 72,
        y: 72,
        children: [
          { kind: 'rect', x: 0, y: 0, width: Math.min(920, width - 144), height: 248, radius: 30, fill: 'rgba(8, 16, 30, 0.72)', stroke: 'rgba(125,211,252,0.18)', filter: 'shadow' },
          { kind: 'text', x: 30, y: 46, width: Math.min(860, width - 204), text: opts.eyebrow, font_size: 18, font_weight: 780, letter_spacing: 2.2, fill: '#7dd3fc' },
          { kind: 'text', x: 30, y: 96, width: Math.min(860, width - 204), text: opts.title, font_size: 60, font_weight: 860, fill: '#f8fafc', line_height: 1.02 },
          { kind: 'text', x: 30, y: 176, width: Math.min(860, width - 204), text: opts.subtitle, font_size: 24, fill: '#c7d7ea', line_height: 1.35 },
        ],
      },
      { kind: 'text', x: 72, y: height - 88, width: width - 144, text: 'Hybrid: local ComfyUI output background + deterministic code overlay', font_size: 18, fill: 'rgba(148,163,184,0.92)' },
    ],
  };
}

function recordScene(id: string, title: string, primary: string, secondary: string[] | undefined, width: number, height: number, notes?: string[]): MediaAssetRecord {
  return {
    id,
    category: 'hybrid-comfy-pack',
    renderer: 'scene_graph',
    title,
    status: 'generated',
    primary_path: primary,
    secondary_paths: secondary,
    width,
    height,
    notes,
  };
}

export async function generateHybridComfyOverlayPack(projectRoot: string): Promise<HybridPackResult> {
  const config = await loadConfig(projectRoot);
  await ensureLogFiles(config);
  const client = new ComfyUiClient(config);

  const runId = makeRunId();
  const outputRoot = path.join(projectRoot, 'outputs');
  const runDir = path.join(outputRoot, 'runs', runId);
  const packDir = path.join(runDir, 'hybrid-comfy');
  const dirCards = path.join(packDir, 'cards');
  await ensureDir(dirCards);

  const manifestPath = path.join(packDir, 'manifest.md');
  const reportPath = path.join(packDir, 'report.md');

  const assets: MediaAssetRecord[] = [];
  const skipped: string[] = [];

  // 1) Choose a scenic-ish reference image (local frames extracted from a reference video).
  const referenceFrame = await findBestReferenceFrame(projectRoot);
  if (!referenceFrame) {
    skipped.push('No reference frames found under outputs/reference-studies; hybrid pack skipped.');
  }

  // 2) Ensure ComfyUI reachable (prefer workflow override / config url).
  const health = await client.healthCheckUrl(config.comfyui_url);
  if (!health.reachable) {
    skipped.push(`ComfyUI unreachable at ${config.comfyui_url}; hybrid pack skipped.`);
  }

  let comfyuiUrl: string | undefined;
  let comfyuiBackgroundOutput: string | undefined;
  let comfyuiBackgroundResolved: string | undefined;

  if (referenceFrame && health.reachable) {
    if (!config.comfyui_input_dir_abs) {
      skipped.push('config.comfyui_input_dir is not set; cannot copy background image into ComfyUI input/.');
    } else {
      // Copy background into ComfyUI input so LoadImage can access it.
      const copied = await safeCopyFileIntoDir({
        sourcePath: referenceFrame,
        destDir: config.comfyui_input_dir_abs,
        destFilename: 'mcp-background.png',
      });

      const runLog = path.join(config.logs_dir_abs, `hybrid-comfy-${runId}.json`);
      const loaded = await loadWorkflow(config, 'passthrough-any-image');
      comfyuiUrl = loaded.configured_entry?.comfyui_url_override ?? config.comfyui_url;
      const patched = patchWorkflowForRun(loaded.workflow_name, loaded.workflow, loaded.configured_entry?.mappings, {
        workflow_name: loaded.workflow_name,
        positive_prompt: '(unused)',
        extra_params: {
          source_image: 'mcp-background.png',
          filename_prefix: `mcp_hybrid_${runId}`,
        },
      });

      await writeRunLog(runLog, {
        timestamp: new Date().toISOString(),
        workflow_name: loaded.workflow_name,
        comfyui_url: comfyuiUrl,
        input_parameters: { reference_frame: referenceFrame, copied_to: copied },
        prompt_json: patched.workflow,
        warnings: patched.warnings,
        status: 'queued',
      });

      const queued = await client.queuePrompt(patched.workflow, comfyuiUrl);
      const history = await client.waitForPrompt(queued.prompt_id, comfyuiUrl);
      const outputs = detectOutputsFromHistory(history, queued.prompt_id);
      comfyuiBackgroundOutput = outputs.images[0]?.filename ?? outputs.images[0]?.path;
      comfyuiBackgroundResolved = (typeof config.comfyui_output_dir_abs === 'string' && outputs.images[0])
        ? path.join(config.comfyui_output_dir_abs, outputs.images[0].subfolder ?? '', outputs.images[0].filename ?? outputs.images[0].path)
        : undefined;

      await writeRunLog(runLog, {
        timestamp: new Date().toISOString(),
        workflow_name: loaded.workflow_name,
        prompt_id: queued.prompt_id,
        comfyui_url: comfyuiUrl,
        input_parameters: { reference_frame: referenceFrame, copied_to: copied },
        prompt_json: patched.workflow,
        warnings: [...patched.warnings, ...outputs.warnings],
        status: 'completed',
        outputs,
      });
    }
  }

  // 3) Render deterministic overlays on top of the ComfyUI output background.
  if (comfyuiBackgroundResolved) {
    const backgroundDataUrl = await fileToDataUrlPng(comfyuiBackgroundResolved);
    const nature = await renderSvgScene({
      output_name: 'nature-overlay',
      scene: overlayScene({
        width: 1600,
        height: 900,
        eyebrow: 'NATURE / CINEMATIC',
        title: 'Calm scenic background',
        subtitle: 'Cinematic-looking background from local ComfyUI.\nOverlay stays deterministic and readable.',
        backgroundDataUrl,
      }),
    }, dirCards);
    assets.push(recordScene('hybrid-nature-overlay', 'Hybrid nature overlay (ComfyUI bg + code overlay)', nature.png_path ?? nature.svg_path, [nature.svg_path], nature.width, nature.height, [comfyuiBackgroundResolved]));

    const travel = await renderSvgScene({
      output_name: 'travel-promo',
      scene: overlayScene({
        width: 1600,
        height: 900,
        eyebrow: 'TRAVEL PROMO',
        title: 'Location promo card',
        subtitle: 'Same background class, different overlay template.\nStructure stays stable across runs.',
        backgroundDataUrl,
      }),
    }, dirCards);
    assets.push(recordScene('hybrid-travel-promo', 'Hybrid travel promo (ComfyUI bg + code overlay)', travel.png_path ?? travel.svg_path, [travel.svg_path], travel.width, travel.height, [comfyuiBackgroundResolved]));
  } else {
    skipped.push('No ComfyUI background output resolved; overlays skipped.');
  }

  const manifestLines: string[] = [
    '# Hybrid ComfyUI Overlay Pack',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Run id: \`${runId}\``,
    '',
    '## Purpose',
    '',
    'Demonstrate the professional, scalable method for “traditional AI looking” outputs:',
    'local ComfyUI for rich backgrounds + deterministic code overlays for typography/layout.',
    '',
    '## Inputs',
    '',
    `- Reference frame: ${referenceFrame ? `\`${path.relative(projectRoot, referenceFrame).replace(/\\\\/g, '/')}\`` : '(none)'}`,
    `- ComfyUI URL: ${comfyuiUrl ?? '(none)'}`,
    `- ComfyUI output background: ${comfyuiBackgroundResolved ? `\`${comfyuiBackgroundResolved}\`` : '(none)'}`,
    '',
    '## Assets',
    '',
    ...assets.map((asset) => `- ${asset.title} -> \`${path.relative(projectRoot, asset.primary_path).replace(/\\\\/g, '/')}\``),
    '',
    '## Skipped',
    '',
    ...(skipped.length ? skipped.map((s) => `- ${s}`) : ['- (none)']),
  ];
  await fs.writeFile(manifestPath, `${manifestLines.join('\n')}\n`, 'utf8');

  const reportLines: string[] = [
    '# Hybrid Pack Report',
    '',
    '## What looks good',
    '',
    '- Background richness comes from an actual image output, not SVG “pretending to be a photo”.',
    '- Overlay remains deterministic: safe margins, hierarchy, readable typography.',
    '',
    '## What is still limited',
    '',
    '- If ComfyUI model checkpoints are missing, background generation must come from passthrough/local photos or lightweight workflows.',
    '- Full cinematic generation depends on your local model availability + hardware (CPU-only can be slow or unstable for large models).',
    '',
    '## Next step',
    '',
    '- Replace the passthrough background workflow with a real scenic workflow once a checkpoint/model is visible in /object_info.',
  ];
  await fs.writeFile(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  return {
    run_id: runId,
    run_dir: runDir,
    manifest_path: manifestPath,
    report_path: reportPath,
    index_path: path.join(outputRoot, 'index.json'),
    gallery_path: path.join(outputRoot, 'gallery', 'index.html'),
    assets,
    skipped,
    comfyui_url: comfyuiUrl,
    comfyui_background_output: comfyuiBackgroundOutput,
    comfyui_background_resolved: comfyuiBackgroundResolved,
  };
}

