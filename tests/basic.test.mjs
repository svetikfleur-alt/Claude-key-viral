import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';
import { renderHtmlCard } from '../src/codegen/htmlCardRenderer.ts';
import { buildSvgSceneMarkup, renderSvgScene } from '../src/codegen/sceneDslRenderer.ts';
import { renderCodeImage, saveSvgMarkup, saveSvgMarkupAsPng } from '../src/codegen/svgRenderer.ts';
import { safeCopyFileIntoDir } from '../src/comfyuiPaths.ts';
import { detectOutputsFromHistory } from '../src/outputDetector.ts';
import { buildStoryboardSvg, buildTreatmentPreviewScenes } from '../src/pipeline/cinematicTreatmentPack.ts';
import { generateDemoAssetPackWithOptions } from '../src/pipeline/demoAssetPack.ts';
import { buildReferenceTreatmentPreview } from '../src/reference/videoReferenceAnalyzer.ts';
import { loadWorkflow } from '../src/workflowStore.ts';
import { dryRunPatchWorkflow, patchWorkflowForRun } from '../src/workflowPatcher.ts';

async function makeTempProject(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comfyui-mcp-runner-'));
  await fs.mkdir(path.join(dir, 'workflows'), { recursive: true });
  await fs.mkdir(path.join(dir, 'logs'), { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents, 'utf8');
  }
  return dir;
}

const workflowFixture = JSON.stringify({
  '3': {
    inputs: { seed: 1, steps: 20, cfg: 8, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    class_type: 'KSampler',
  },
  '5': {
    inputs: { width: 512, height: 512, batch_size: 1 },
    class_type: 'EmptyLatentImage',
  },
  '6': {
    inputs: { text: 'A sample positive prompt', clip: ['4', 1] },
    class_type: 'CLIPTextEncode',
  },
  '7': {
    inputs: { text: 'A sample negative prompt', clip: ['4', 1] },
    class_type: 'CLIPTextEncode',
  },
  '8': {
    inputs: { images: ['9', 0], filename_prefix: 'ComfyUI' },
    class_type: 'SaveImage',
  },
}, null, 2);

const configFixture = JSON.stringify({
  comfyui_url: 'http://127.0.0.1:8188',
  workflows_dir: './workflows',
  logs_dir: './logs',
  generated_media_dir: './generated-media',
  outputs_index_file: './logs/output-index.json',
  request_timeout_seconds: 30,
  polling_interval_seconds: 2,
  polling_timeout_seconds: 300,
  workflows: {
    'basic-image': {
      file: 'basic-image.workflow.json',
      description: 'Test workflow',
      mappings: {
        positive_prompt: { node_id: '6', field_path: ['inputs', 'text'] },
        negative_prompt: { node_id: '7', field_path: ['inputs', 'text'] },
        seed: { node_id: '3', field_path: ['inputs', 'seed'] },
        width: { node_id: '5', field_path: ['inputs', 'width'] },
        height: { node_id: '5', field_path: ['inputs', 'height'] },
        extra_params: {
          steps: { node_id: '3', field_path: ['inputs', 'steps'] },
        },
      },
    },
  },
}, null, 2);

test('config loading enforces output index inside logs dir', async () => {
  const root = await makeTempProject({
    'config.json': JSON.stringify({
      comfyui_url: 'http://127.0.0.1:8188',
      workflows_dir: './workflows',
      logs_dir: './logs',
      generated_media_dir: './generated-media',
      outputs_index_file: './outside/output-index.json',
      request_timeout_seconds: 30,
      polling_interval_seconds: 2,
      polling_timeout_seconds: 300,
      workflows: {},
    }),
  });
  await assert.rejects(() => loadConfig(root), /Path safety error/);
});

test('config supports per-workflow comfyui_url_override and default_inputs', async () => {
  const root = await makeTempProject({
    'config.json': JSON.stringify({
      comfyui_url: 'http://127.0.0.1:8188',
      workflows_dir: './workflows',
      logs_dir: './logs',
      generated_media_dir: './generated-media',
      outputs_index_file: './logs/output-index.json',
      request_timeout_seconds: 30,
      polling_interval_seconds: 2,
      polling_timeout_seconds: 300,
      workflows: {
        'qwen-image-edit-pro': {
          file: 'qwen-image-edit-pro.workflow.json',
          comfyui_url_override: 'http://127.0.0.1:8000',
          default_inputs: { extra_params: { denoise: 0.7 } },
          mappings: {},
        },
      },
    }),
    'workflows/qwen-image-edit-pro.workflow.json': '{}',
  });
  const config = await loadConfig(root);
  assert.equal(config.workflows['qwen-image-edit-pro'].comfyui_url_override, 'http://127.0.0.1:8000');
  assert.equal(config.workflows['qwen-image-edit-pro'].default_inputs.extra_params.denoise, 0.7);
});

test('safeCopyFileIntoDir prevents path traversal', async () => {
  const root = await makeTempProject({
    'generated-media/source.png': 'not-a-real-png',
  });
  const destDir = path.join(root, 'comfy-input');
  await assert.rejects(() => safeCopyFileIntoDir({
    sourcePath: path.join(root, 'generated-media', 'source.png'),
    destDir,
    destFilename: '../escape.png',
  }), /Invalid filename|Path safety error/);
});

test('loadWorkflow returns configured workflow JSON', async () => {
  const root = await makeTempProject({
    'config.json': configFixture,
    'workflows/basic-image.workflow.json': workflowFixture,
  });
  const config = await loadConfig(root);
  const loaded = await loadWorkflow(config, 'basic-image');
  assert.equal(loaded.workflow_file, 'basic-image.workflow.json');
  assert.equal(typeof loaded.workflow['3'], 'object');
});

test('missing workflow file returns a clear error', async () => {
  const root = await makeTempProject({ 'config.json': configFixture });
  const config = await loadConfig(root);
  await assert.rejects(() => loadWorkflow(config, 'basic-image'), /Workflow file not found/);
});

test('workflow patching applies mapped values and dry run reports changed nodes', async () => {
  const root = await makeTempProject({
    'config.json': configFixture,
    'workflows/basic-image.workflow.json': workflowFixture,
  });
  const config = await loadConfig(root);
  const loaded = await loadWorkflow(config, 'basic-image');
  const dryRun = dryRunPatchWorkflow('basic-image', loaded.workflow, loaded.configured_entry?.mappings, {
    workflow_name: 'basic-image',
    positive_prompt: 'sunlit forest',
    seed: 42,
    extra_params: { steps: 30 },
  });

  assert.equal(dryRun.ready_to_run, true);
  assert.equal(dryRun.changed_nodes.length, 3);
  assert.equal(dryRun.final_mapped_parameters.seed, 42);
});

test('missing mapping node error is clear', async () => {
  const root = await makeTempProject({
    'config.json': configFixture,
    'workflows/basic-image.workflow.json': workflowFixture,
  });
  const config = await loadConfig(root);
  const loaded = await loadWorkflow(config, 'basic-image');
  const brokenMappings = structuredClone(loaded.configured_entry.mappings);
  brokenMappings.seed.node_id = '999';
  assert.throws(() => patchWorkflowForRun('basic-image', loaded.workflow, brokenMappings, {
    workflow_name: 'basic-image',
    positive_prompt: 'hello',
    seed: 99,
  }), /Mapping for seed points to node 999/);
});

test('dry run warns when extra params are not mapped', async () => {
  const root = await makeTempProject({
    'config.json': configFixture,
    'workflows/basic-image.workflow.json': workflowFixture,
  });
  const config = await loadConfig(root);
  const loaded = await loadWorkflow(config, 'basic-image');
  const result = dryRunPatchWorkflow('basic-image', loaded.workflow, loaded.configured_entry?.mappings, {
    workflow_name: 'basic-image',
    positive_prompt: 'hello',
    extra_params: { cfg_scale: 12 },
  });
  assert.equal(result.ready_to_run, false);
  assert.match(result.warnings[0], /No mapping configured for extra_params.cfg_scale/);
});

test('output detector groups images, videos, and other files', async () => {
  const outputs = detectOutputsFromHistory({
    abc123: {
      outputs: {
        '8': {
          images: [{ filename: 'frame.png', subfolder: 'images' }],
          videos: [{ filename: 'clip.mp4', subfolder: 'videos' }],
          files: [{ filename: 'meta.json', subfolder: 'misc' }],
        },
      },
    },
  }, 'abc123');

  assert.equal(outputs.images.length, 1);
  assert.equal(outputs.videos.length, 1);
  assert.equal(outputs.other.length, 1);
});

test('svg template renderer writes a real svg file', async () => {
  const root = await makeTempProject({});
  const result = await renderCodeImage({
    template: 'feature_card',
    title: 'Code SVG',
    subtitle: 'Generated locally',
    bullets: ['local-first', 'saved to disk'],
    output_name: 'feature-card-test',
  }, path.join(root, 'generated-media'));

  const contents = await fs.readFile(result.file_path, 'utf8');
  assert.match(contents, /<svg/);
  assert.equal(path.basename(result.file_path), 'feature-card-test.svg');
});

test('raw svg markup saver persists provided markup', async () => {
  const root = await makeTempProject({});
  const result = await saveSvgMarkup({
    svg_markup: '<svg width="320" height="180" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="180" fill="#123456"/></svg>',
    output_name: 'raw-svg-test',
  }, path.join(root, 'generated-media'));

  const contents = await fs.readFile(result.file_path, 'utf8');
  assert.match(contents, /#123456/);
  assert.equal(result.width, 320);
  assert.equal(result.height, 180);
});

test('raw svg markup can be rasterized to png', async () => {
  const root = await makeTempProject({});
  const result = await saveSvgMarkupAsPng({
    svg_markup: '<svg width="240" height="160" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="160" fill="#ff6600"/></svg>',
    output_name: 'raw-png-test',
  }, path.join(root, 'generated-media'));

  const stat = await fs.stat(result.file_path);
  assert.equal(path.basename(result.file_path), 'raw-png-test.png');
  assert.ok(stat.size > 0);
  assert.equal(result.width, 240);
  assert.equal(result.height, 160);
});

test('html card renderer writes svg and png outputs', async () => {
  const root = await makeTempProject({});
  const result = await renderHtmlCard({
    template: 'project_hero_banner',
    title: 'Claude MCP Media Runner',
    subtitle: 'Structure before randomness.',
    badges: ['Local-first', 'Code-first'],
    bullets: ['Deterministic output folders'],
    output_name: 'hero-card-test',
  }, path.join(root, 'generated-media'));

  const svg = await fs.readFile(result.svg_path, 'utf8');
  const pngStat = await fs.stat(result.png_path);
  assert.match(svg, /Claude MCP Media Runner/);
  assert.ok(pngStat.size > 0);
});

test('scene graph markup builder renders stack and text fragments', () => {
  const built = buildSvgSceneMarkup({
    width: 800,
    height: 400,
    background: '#08101f',
    nodes: [
      {
        kind: 'stack',
        x: 40,
        y: 40,
        width: 320,
        direction: 'vertical',
        gap: 12,
        padding: 20,
        fill: '#0f172a',
        radius: 18,
        children: [
          { kind: 'text', x: 0, y: 0, width: 280, text: 'Scene graph title', font_size: 28, font_weight: 700, fill: '#f8fafc' },
          { kind: 'text', x: 0, y: 0, width: 280, text: 'Structured SVG code.', font_size: 18, fill: '#c7d7ea' },
        ],
      },
    ],
  });

  assert.match(built.svg_markup, /Scene graph title/);
  assert.match(built.svg_markup, /Structured SVG code/);
  assert.equal(built.text_fragments.length >= 2, true);
});

test('scene graph markup builder supports gradients filters and vector primitives', () => {
  const built = buildSvgSceneMarkup({
    width: 960,
    height: 540,
    background: 'url(#bg)',
    defs: {
      gradients: [
        {
          id: 'bg',
          type: 'linear',
          stops: [
            { offset: '0%', color: '#020617' },
            { offset: '100%', color: '#172554' },
          ],
        },
      ],
      filters: [
        { id: 'soft', type: 'drop_shadow', dx: 0, dy: 12, std_deviation: 18, color: '#000000', opacity: 0.4 },
      ],
    },
    nodes: [
      { kind: 'circle', cx: 720, cy: 120, r: 180, fill: 'rgba(125,211,252,0.2)' },
      { kind: 'ellipse', cx: 520, cy: 470, rx: 260, ry: 60, fill: 'rgba(134,239,172,0.16)' },
      { kind: 'path', d: 'M90 340 C240 220 420 400 620 260', stroke: '#7dd3fc', stroke_width: 6, stroke_linecap: 'round' },
      { kind: 'polygon', points: [[680, 280], [820, 320], [780, 430], [640, 390]], fill: 'rgba(250,204,21,0.16)', filter: 'soft' },
      { kind: 'text', x: 80, y: 90, width: 520, text: 'Advanced scene graph', font_size: 44, font_weight: 700 },
    ],
  });

  assert.match(built.svg_markup, /linearGradient/);
  assert.match(built.svg_markup, /feDropShadow/);
  assert.match(built.svg_markup, /<circle/);
  assert.match(built.svg_markup, /<ellipse/);
  assert.match(built.svg_markup, /<path/);
  assert.match(built.svg_markup, /<polygon/);
  assert.match(built.svg_markup, /Advanced scene graph/);
});

test('scene graph renderer writes svg and png outputs', async () => {
  const root = await makeTempProject({});
  const result = await renderSvgScene({
    output_name: 'scene-graph-test',
    scene: {
      width: 900,
      height: 540,
      background: '#08101f',
      nodes: [
        { kind: 'rect', x: 30, y: 30, width: 840, height: 480, radius: 24, fill: '#0f172a', stroke: '#334155' },
        { kind: 'text', x: 70, y: 80, width: 420, text: 'Scene graph output', font_size: 42, font_weight: 700, fill: '#f8fafc' },
        { kind: 'text', x: 70, y: 150, width: 500, text: 'Every image can come from SVG code.', font_size: 24, fill: '#bfd0e4' },
      ],
    },
  }, path.join(root, 'generated-media'));

  const svg = await fs.readFile(result.svg_path, 'utf8');
  const pngStat = await fs.stat(result.png_path);
  assert.match(svg, /Scene graph output/);
  assert.ok(pngStat.size > 0);
});

test('demo asset pack creates run folders manifest report and index without video', async () => {
  const root = await makeTempProject({});
  const result = await generateDemoAssetPackWithOptions(root, {
    includeVideo: false,
    outputRoot: path.join(root, 'outputs'),
    updateExamples: false,
  });

  const manifest = await fs.readFile(result.manifest_path, 'utf8');
  const report = await fs.readFile(result.report_path, 'utf8');
  const index = JSON.parse(await fs.readFile(result.index_path, 'utf8'));
  const gallery = await fs.readFile(result.gallery_path, 'utf8');

  assert.match(manifest, /Media run manifest/);
  assert.match(report, /Media pipeline report/);
  assert.equal(Array.isArray(index), true);
  assert.ok(index.length >= 1);
  assert.match(gallery, /Output gallery/);
  assert.ok(result.assets.some((asset) => asset.id === 'hero-banner'));
});

test('reference treatment preview summarizes cinematic targets', () => {
  const preview = buildReferenceTreatmentPreview({
    width: 1280,
    height: 720,
    duration_seconds: 8,
    fps: 24,
    frame_count: 192,
    has_audio: true,
    video_codec: 'h264',
    audio_codec: 'aac',
  });
  assert.match(preview[0], /1280x720/);
  assert.match(preview[1], /24/);
});

test('treatment preview scenes carry frame-backed cinematic direction', () => {
  const scenes = buildTreatmentPreviewScenes({
    source_video: 'reference.mp4',
    duration_seconds: 8,
    scenes: [
      {
        label: 'Establishing reveal',
        start_seconds: 0,
        end_seconds: 2,
        objective: 'Introduce the scene with strong atmosphere.',
        visual_notes: ['Wide composition.', 'Premium depth.'],
      },
    ],
  }, [
    {
      timecode_seconds: 0,
      data_url: 'data:image/png;base64,AAAA',
    },
  ]);

  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].media_data_url, 'data:image/png;base64,AAAA');
  assert.match(scenes[0].body, /Wide composition/);
});

test('storyboard svg includes shot labels and source metadata', () => {
  const svg = buildStoryboardSvg({
    title: 'Cinematic shot board',
    subtitle: 'Reference frames + timing + intent in one inspectable layout.',
    sourceLabel: 'mp_.mp4',
    metadata: {
      width: 1280,
      height: 720,
      duration_seconds: 8,
      fps: 24,
      frame_count: 192,
      has_audio: true,
      video_codec: 'h264',
      audio_codec: 'aac',
    },
    frames: Array.from({ length: 4 }, (_, index) => ({
      timecode_seconds: index * 2,
      data_url: 'data:image/png;base64,AAAA',
    })),
    shotPlan: {
      source_video: 'mp_.mp4',
      duration_seconds: 8,
      scenes: [
        { label: 'Establishing reveal', start_seconds: 0, end_seconds: 2, objective: 'Open strong.', visual_notes: ['Wide composition.', 'Light movement.'] },
        { label: 'Primary action beat', start_seconds: 2, end_seconds: 4, objective: 'Track the subject.', visual_notes: ['Clear silhouette.', 'Visible depth.'] },
        { label: 'Close intensity beat', start_seconds: 4, end_seconds: 6, objective: 'Move closer.', visual_notes: ['Texture rich.', 'Dynamic parallax.'] },
        { label: 'Exit / payoff', start_seconds: 6, end_seconds: 8, objective: 'Land the final composition.', visual_notes: ['Balanced frame.', 'Clean end read.'] },
      ],
    },
  });

  assert.match(svg, /Cinematic shot board/);
  assert.match(svg, /SHOT 01/);
  assert.match(svg, /mp_\.mp4/);
  assert.match(svg, /1280x720/);
});
