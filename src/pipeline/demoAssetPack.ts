import fs from 'node:fs/promises';
import path from 'node:path';
import { renderHtmlCard } from '../codegen/htmlCardRenderer.js';
import { renderRemotionVideo } from '../codegen/remotionRenderer.js';
import { renderSvgScene, renderSvgSceneVideo } from '../codegen/sceneDslRenderer.js';
import { generateOutputGallery } from './outputGallery.js';
import { generateCinematicTreatmentPack } from './cinematicTreatmentPack.js';
import { saveSvgMarkup, sanitizeFileStem } from '../codegen/svgRenderer.js';
import type { MediaAssetRecord, MediaPipelineRunResult, RemotionVideoInput, SvgSceneSpec } from '../types.js';

type RunIndexEntry = {
  run_id: string;
  timestamp: string;
  run_dir: string;
  manifest_path: string;
  report_path: string;
  assets_count: number;
  video_count: number;
  status: 'completed';
  featured_assets?: Array<{
    title: string;
    path: string;
    kind: 'image' | 'video' | 'document';
  }>;
};

type ValidationRecord = {
  file: string;
  ok: boolean;
  note: string;
};

const PROJECT_TITLE = 'Claude MCP Media Runner';
const PROJECT_SUBTITLE = 'Local-first code-rendered media workflows for Claude, ComfyUI, and future image/video backends.';

function scenePill(x: number, y: number, text: string, accent: string) {
  const width = Math.max(140, text.length * 12 + 48);
  return {
    kind: 'group' as const,
    x,
    y,
    children: [
      { kind: 'rect' as const, x: 0, y: 0, width, height: 48, radius: 18, fill: 'rgba(9, 16, 30, 0.76)', stroke: `${accent}44` },
      { kind: 'text' as const, x: 22, y: 12, width: width - 44, text, font_size: 20, font_weight: 700, fill: accent },
    ],
  };
}

function scenePanel(title: string, body: string, accent: string, width = 360) {
  return {
    kind: 'stack' as const,
    x: 0,
    y: 0,
    width,
    direction: 'vertical' as const,
    gap: 14,
    padding: 22,
    fill: 'rgba(8, 14, 30, 0.92)',
    stroke: `${accent}2c`,
    radius: 24,
    children: [
      { kind: 'rect' as const, x: 0, y: 0, width: 42, height: 8, radius: 4, fill: accent },
      { kind: 'text' as const, x: 0, y: 0, width: width - 44, text: title, font_size: 30, font_weight: 700, fill: '#f8fafc', line_height: 1.12 },
      { kind: 'text' as const, x: 0, y: 0, width: width - 44, text: body, font_size: 18, fill: '#bfd0e4', line_height: 1.45 },
    ],
  };
}

function buildSceneGraphHeroSpec(): SvgSceneSpec {
  return {
    width: 1600,
    height: 900,
    background: 'url(#sceneHeroBg)',
    defs: {
      gradients: [
        {
          id: 'sceneHeroBg',
          type: 'linear',
          x1: '0%',
          y1: '0%',
          x2: '100%',
          y2: '100%',
          stops: [
            { offset: '0%', color: '#050b16' },
            { offset: '48%', color: '#081426' },
            { offset: '100%', color: '#10233a' },
          ],
        },
        {
          id: 'cyanOrb',
          type: 'radial',
          cx: '50%',
          cy: '50%',
          r: '60%',
          stops: [
            { offset: '0%', color: '#7dd3fc', opacity: 0.42 },
            { offset: '58%', color: '#38bdf8', opacity: 0.13 },
            { offset: '100%', color: '#0f172a', opacity: 0 },
          ],
        },
        {
          id: 'panelGlass',
          type: 'linear',
          x1: '0%',
          y1: '0%',
          x2: '100%',
          y2: '100%',
          stops: [
            { offset: '0%', color: '#0f1e35', opacity: 0.9 },
            { offset: '100%', color: '#060b16', opacity: 0.92 },
          ],
        },
      ],
      filters: [
        { id: 'softShadow', type: 'drop_shadow', dx: 0, dy: 24, std_deviation: 28, color: '#020617', opacity: 0.55 },
        { id: 'cyanGlow', type: 'drop_shadow', dx: 0, dy: 0, std_deviation: 18, color: '#38bdf8', opacity: 0.42 },
      ],
    },
    nodes: [
      { kind: 'circle', cx: 1270, cy: 178, r: 360, fill: 'url(#cyanOrb)', opacity: 0.72 },
      { kind: 'ellipse', cx: 1040, cy: 820, rx: 620, ry: 160, fill: 'url(#cyanOrb)', opacity: 0.22 },
      { kind: 'path', d: 'M960 640 C1080 520 1190 560 1308 418 C1374 338 1438 330 1500 268', stroke: 'rgba(125,211,252,0.34)', stroke_width: 3, stroke_linecap: 'round', fill: 'none' },
      { kind: 'path', d: 'M910 712 C1048 626 1180 690 1334 574 C1416 512 1456 500 1510 470', stroke: 'rgba(134,239,172,0.22)', stroke_width: 2, stroke_linecap: 'round', fill: 'none' },
      { kind: 'polygon', points: '1260,126 1356,160 1326,238 1224,220', fill: 'rgba(125,211,252,0.08)', stroke: 'rgba(125,211,252,0.16)' },
      { kind: 'rect', x: 46, y: 46, width: 1508, height: 808, radius: 34, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 84, y: 90, width: 440, text: 'SCENE GRAPH CODEGEN', font_size: 18, font_weight: 700, fill: '#7dd3fc', letter_spacing: 2.2 },
      { kind: 'text', x: 84, y: 128, width: 820, text: 'Every image can be described as structured SVG code', font_size: 58, font_weight: 760, fill: '#f8fafc', line_height: 1.02 },
      { kind: 'text', x: 84, y: 372, width: 780, text: 'Panels, badges, titles, connectors, timelines, and reference boards can all come from a shared scene spec instead of one-off template code.', font_size: 26, fill: '#c7d7ea', line_height: 1.36 },
      scenePill(84, 492, 'Shared scene spec', '#7dd3fc'),
      scenePill(350, 492, 'SVG + PNG output', '#86efac'),
      scenePill(610, 492, 'Video scene reuse', '#facc15'),
      {
        kind: 'stack',
        x: 1030,
        y: 94,
        width: 430,
        direction: 'vertical',
        gap: 22,
        filter: 'softShadow',
        children: [
          scenePanel('Exact layout', 'Text, spacing, rhythm, and hierarchy stay deterministic.', '#7dd3fc'),
          scenePanel('Same scene into video', 'A sequence of SVG scenes can become a structured MP4 without changing the source model.', '#93c5fd'),
        ],
      },
      {
        kind: 'stack',
        x: 84,
        y: 618,
        width: 760,
        direction: 'vertical',
        gap: 18,
        padding: 24,
        fill: 'url(#panelGlass)',
        stroke: 'rgba(125,211,252,0.12)',
        radius: 28,
        filter: 'softShadow',
        children: [
          { kind: 'text', x: 0, y: 0, width: 712, text: 'Why this matters', font_size: 24, font_weight: 700, fill: '#f8fafc' },
          { kind: 'text', x: 0, y: 0, width: 712, text: 'Reusable visual grammar can power launch graphics, diagrams, storyboards, and scene-based videos from the same structural input.', font_size: 23, fill: '#bfd0e4', line_height: 1.42 },
        ],
      },
    ],
  };
}

function buildSceneGraphTimelineSpec(): SvgSceneSpec {
  return {
    width: 1600,
    height: 900,
    background: 'url(#timelineBg)',
    defs: {
      gradients: [
        {
          id: 'timelineBg',
          type: 'linear',
          x1: '0%',
          y1: '0%',
          x2: '100%',
          y2: '100%',
          stops: [
            { offset: '0%', color: '#08101f' },
            { offset: '54%', color: '#0b1424' },
            { offset: '100%', color: '#111827' },
          ],
        },
        {
          id: 'timelineOrb',
          type: 'radial',
          cx: '50%',
          cy: '50%',
          r: '55%',
          stops: [
            { offset: '0%', color: '#93c5fd', opacity: 0.34 },
            { offset: '68%', color: '#38bdf8', opacity: 0.08 },
            { offset: '100%', color: '#020617', opacity: 0 },
          ],
        },
      ],
      filters: [
        { id: 'boardShadow', type: 'drop_shadow', dx: 0, dy: 18, std_deviation: 24, color: '#020617', opacity: 0.45 },
      ],
    },
    nodes: [
      { kind: 'circle', cx: 1350, cy: 148, r: 280, fill: 'url(#timelineOrb)', opacity: 0.7 },
      { kind: 'circle', cx: 240, cy: 790, r: 260, fill: 'url(#timelineOrb)', opacity: 0.24 },
      { kind: 'path', d: 'M172 570 C440 520 700 622 980 570 C1140 540 1278 540 1420 570', stroke: 'rgba(125,211,252,0.18)', stroke_width: 20, stroke_linecap: 'round', fill: 'none' },
      { kind: 'rect', x: 42, y: 42, width: 1516, height: 816, radius: 34, stroke: 'rgba(125,211,252,0.12)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 86, y: 96, width: 420, text: 'SCENE SYSTEM', font_size: 18, font_weight: 700, fill: '#7dd3fc', letter_spacing: 2.4 },
      { kind: 'text', x: 86, y: 138, width: 860, text: 'One scene graph, many outputs', font_size: 54, font_weight: 760, fill: '#f8fafc', line_height: 1.04 },
      { kind: 'text', x: 86, y: 278, width: 760, text: 'The same structure can power stills, storyboards, and timeline-driven video scenes.', font_size: 25, fill: '#c7d7ea', line_height: 1.36 },
      { kind: 'line', x1: 180, y1: 570, x2: 1420, y2: 570, stroke: 'rgba(125,211,252,0.28)', stroke_width: 4 },
      { ...scenePanel('Still frame', 'SVG scene to SVG and PNG outputs.', '#7dd3fc', 300), x: 120, y: 392, filter: 'boardShadow' },
      { ...scenePanel('Storyboard board', 'Compose multiple scenes with consistent typography and alignment.', '#93c5fd', 340), x: 512, y: 366, filter: 'boardShadow' },
      { ...scenePanel('Scene sequence video', 'SVG scenes to data URLs to MP4.', '#86efac', 330), x: 954, y: 392, filter: 'boardShadow' },
      {
        kind: 'stack',
        x: 86,
        y: 620,
        width: 1350,
        direction: 'horizontal',
        gap: 22,
        children: [
          scenePanel('More precise than templates alone', 'Reusable primitives make it easier to build new assets without duplicating layout logic.', '#7dd3fc', 360),
          scenePanel('Still local-first', 'The same scene specs render without cloud calls or mandatory external services.', '#86efac', 360),
          scenePanel('Ready for richer backends', 'The code-first scene graph can sit underneath Comfy or future video backends as a planning layer.', '#facc15', 360),
        ],
      },
    ],
  };
}

function buildSceneSequenceSpecs(): SvgSceneSpec[] {
  return [
    buildSceneGraphHeroSpec(),
    buildSceneGraphTimelineSpec(),
    {
      width: 1280,
      height: 720,
      background: 'url(#sequenceBg)',
      defs: {
        gradients: [
          {
            id: 'sequenceBg',
            type: 'linear',
            x1: '0%',
            y1: '0%',
            x2: '100%',
            y2: '100%',
            stops: [
              { offset: '0%', color: '#050b16' },
              { offset: '55%', color: '#081426' },
              { offset: '100%', color: '#172554' },
            ],
          },
          {
            id: 'sequenceGlow',
            type: 'radial',
            cx: '50%',
            cy: '50%',
            r: '60%',
            stops: [
              { offset: '0%', color: '#7dd3fc', opacity: 0.28 },
              { offset: '66%', color: '#2563eb', opacity: 0.1 },
              { offset: '100%', color: '#020617', opacity: 0 },
            ],
          },
        ],
        filters: [
          { id: 'sequenceShadow', type: 'drop_shadow', dx: 0, dy: 18, std_deviation: 22, color: '#020617', opacity: 0.48 },
        ],
      },
      nodes: [
        { kind: 'circle', cx: 1010, cy: 140, r: 320, fill: 'url(#sequenceGlow)', opacity: 0.65 },
        { kind: 'ellipse', cx: 760, cy: 650, rx: 460, ry: 96, fill: 'url(#sequenceGlow)', opacity: 0.22 },
        { kind: 'path', d: 'M704 214 C804 154 894 184 990 126 C1054 88 1118 84 1190 104', stroke: 'rgba(125,211,252,0.28)', stroke_width: 3, stroke_linecap: 'round', fill: 'none' },
        { kind: 'polygon', points: '1020,208 1168,248 1122,376 980,330', fill: 'rgba(125,211,252,0.08)', stroke: 'rgba(125,211,252,0.14)' },
        { kind: 'rect', x: 48, y: 48, width: 1184, height: 624, radius: 28, stroke: 'rgba(125,211,252,0.12)', fill: 'rgba(8, 16, 30, 0.86)', filter: 'sequenceShadow' },
        { kind: 'text', x: 86, y: 104, width: 560, text: 'VIDEO FROM THE SAME SVG SOURCE', font_size: 18, font_weight: 700, fill: '#7dd3fc', letter_spacing: 2.2 },
        { kind: 'text', x: 86, y: 148, width: 620, text: 'Scene timing becomes code too', font_size: 54, font_weight: 760, fill: '#f8fafc', line_height: 0.98 },
        { kind: 'text', x: 86, y: 208, width: 620, text: 'Each scene can define its own structure and duration, then flow into a shared Remotion sequence without losing determinism.', font_size: 24, fill: '#bfd0e4', line_height: 1.42 },
        {
          kind: 'stack',
          x: 86,
          y: 320,
          width: 520,
          direction: 'vertical',
          gap: 16,
          children: [
            scenePanel('Scene 01', 'Intro layout and visual thesis.', '#7dd3fc'),
            scenePanel('Scene 02', 'System breakdown and connectors.', '#93c5fd'),
            scenePanel('Scene 03', 'Precise timing and transition-ready output.', '#86efac'),
          ],
        },
        {
          kind: 'stack',
          x: 760,
          y: 160,
          width: 410,
          direction: 'vertical',
          gap: 18,
          padding: 24,
          fill: 'rgba(5, 11, 23, 0.92)',
          stroke: 'rgba(125,211,252,0.16)',
          radius: 28,
          children: [
            { kind: 'text', x: 0, y: 0, width: 362, text: 'Timeline values', font_size: 26, font_weight: 700, fill: '#f8fafc' },
            { kind: 'text', x: 0, y: 0, width: 362, text: '4.0s • 5.5s • 4.5s', font_size: 22, fill: '#7dd3fc' },
            { kind: 'text', x: 0, y: 0, width: 362, text: 'No visual guessing. The composition, copy, and beat length are all authored deliberately.', font_size: 20, fill: '#bfd0e4', line_height: 1.46 },
          ],
        },
      ],
    },
  ];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function makeRunId(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function fileSize(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.size;
}

async function getGitDescriptor(projectRoot: string): Promise<string> {
  const headPath = path.join(projectRoot, '.git', 'HEAD');
  const head = (await readTextIfExists(headPath))?.trim();
  if (!head) return 'git metadata unavailable';

  if (head.startsWith('ref: ')) {
    const ref = head.slice(5).trim();
    const refPath = path.join(projectRoot, '.git', ...ref.split('/'));
    const commit = (await readTextIfExists(refPath))?.trim();
    const branch = ref.split('/').at(-1) ?? ref;
    return commit ? `${branch} @ ${commit.slice(0, 7)}` : branch;
  }

  return head.slice(0, 7);
}

function pipelineDiagramSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#08101f"/>
      <stop offset="55%" stop-color="#0c1728"/>
      <stop offset="100%" stop-color="#122236"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0e1b2f"/>
      <stop offset="100%" stop-color="#0a1322"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)"/>
  <circle cx="210" cy="150" r="190" fill="rgba(55,165,255,0.14)" filter="url(#soft)"/>
  <circle cx="1370" cy="780" r="220" fill="rgba(52,211,153,0.12)" filter="url(#soft)"/>
  <rect x="40" y="40" width="1520" height="820" rx="40" fill="none" stroke="rgba(125,211,252,0.16)"/>
  <text x="90" y="118" fill="#f8fafc" font-size="62" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Structured local media pipeline</text>
  <text x="90" y="166" fill="#b7c6db" font-size="28" font-family="Segoe UI, Arial, sans-serif">Claude Desktop → Local MCP Runner → Code renderers / Local ComfyUI → Outputs / Logs / Gallery</text>

  <rect x="90" y="248" width="280" height="166" rx="28" fill="url(#panel)" stroke="rgba(125,211,252,0.34)"/>
  <rect x="432" y="248" width="280" height="166" rx="28" fill="url(#panel)" stroke="rgba(147,197,253,0.34)"/>
  <rect x="774" y="214" width="320" height="106" rx="26" fill="url(#panel)" stroke="rgba(125,211,252,0.24)"/>
  <rect x="774" y="346" width="320" height="106" rx="26" fill="url(#panel)" stroke="rgba(134,239,172,0.24)"/>
  <rect x="1156" y="248" width="350" height="166" rx="28" fill="url(#panel)" stroke="rgba(134,239,172,0.34)"/>

  <text x="122" y="300" fill="#7dd3fc" font-size="16" font-family="Segoe UI, Arial, sans-serif" letter-spacing="2">SOURCE</text>
  <text x="122" y="338" fill="#f8fafc" font-size="34" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Claude / Agent</text>
  <text x="122" y="378" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">Brief, constraints,</text>
  <text x="122" y="408" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">asset plan, review loop.</text>

  <text x="464" y="300" fill="#93c5fd" font-size="16" font-family="Segoe UI, Arial, sans-serif" letter-spacing="2">ORCHESTRATION</text>
  <text x="464" y="338" fill="#f8fafc" font-size="34" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Local MCP Runner</text>
  <text x="464" y="378" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">Template selection,</text>
  <text x="464" y="408" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">render, validate, index.</text>

  <text x="806" y="254" fill="#7dd3fc" font-size="16" font-family="Segoe UI, Arial, sans-serif" letter-spacing="2">PRECISE BACKEND</text>
  <text x="806" y="288" fill="#f8fafc" font-size="28" font-family="Segoe UI, Arial, sans-serif" font-weight="700">HTML / CSS / SVG / Remotion</text>
  <text x="806" y="314" fill="#bfd0e4" font-size="20" font-family="Segoe UI, Arial, sans-serif">Deterministic cards, diagrams, thumbnails, and videos.</text>

  <text x="806" y="386" fill="#86efac" font-size="16" font-family="Segoe UI, Arial, sans-serif" letter-spacing="2">OPTIONAL RICHNESS</text>
  <text x="806" y="420" fill="#f8fafc" font-size="28" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Local ComfyUI</text>
  <text x="806" y="446" fill="#bfd0e4" font-size="20" font-family="Segoe UI, Arial, sans-serif">Use when realism or cinematic motion is actually needed.</text>

  <text x="1188" y="300" fill="#86efac" font-size="16" font-family="Segoe UI, Arial, sans-serif" letter-spacing="2">OUTPUTS</text>
  <text x="1188" y="338" fill="#f8fafc" font-size="34" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Runs, logs, gallery</text>
  <text x="1188" y="378" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">Inspectable folders,</text>
  <text x="1188" y="408" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">manifest, report, review.</text>

  <path d="M370 330 C 404 330, 400 330, 432 330" stroke="#7dd3fc" stroke-width="6" fill="none"/>
  <path d="M712 330 C 750 330, 736 268, 774 268" stroke="#7dd3fc" stroke-width="6" fill="none"/>
  <path d="M712 330 C 750 330, 736 398, 774 398" stroke="#86efac" stroke-width="6" fill="none"/>
  <path d="M1094 268 C 1124 268, 1126 330, 1156 330" stroke="#7dd3fc" stroke-width="6" fill="none"/>
  <path d="M1094 398 C 1124 398, 1126 330, 1156 330" stroke="#86efac" stroke-width="6" fill="none"/>

  <rect x="90" y="560" width="420" height="200" rx="28" fill="rgba(8,16,30,0.84)" stroke="rgba(125,211,252,0.14)"/>
  <text x="122" y="608" fill="#7dd3fc" font-size="18" font-family="Segoe UI, Arial, sans-serif" letter-spacing="2">LOCAL-FIRST</text>
  <text x="122" y="650" fill="#f8fafc" font-size="30" font-family="Segoe UI, Arial, sans-serif" font-weight="700">No hosted server required</text>
  <text x="122" y="690" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">The core pipeline runs on the user’s machine.</text>
  <text x="122" y="722" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">No mandatory API key and no cloud dashboard.</text>

  <rect x="560" y="560" width="420" height="200" rx="28" fill="rgba(8,16,30,0.84)" stroke="rgba(125,211,252,0.14)"/>
  <text x="592" y="608" fill="#93c5fd" font-size="18" font-family="Segoe UI, Arial, sans-serif" letter-spacing="2">STRUCTURED OUTPUTS</text>
  <text x="592" y="650" fill="#f8fafc" font-size="30" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Readable and reproducible</text>
  <text x="592" y="690" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">Every run records what was rendered, where it lives,</text>
  <text x="592" y="722" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">and what still needs the next pass.</text>

  <rect x="1030" y="560" width="476" height="200" rx="28" fill="rgba(8,16,30,0.84)" stroke="rgba(125,211,252,0.14)"/>
  <text x="1062" y="608" fill="#86efac" font-size="18" font-family="Segoe UI, Arial, sans-serif" letter-spacing="2">STRUCTURE BEFORE RANDOMNESS</text>
  <text x="1062" y="650" fill="#f8fafc" font-size="30" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Precise assets first, generative richness second</text>
  <text x="1062" y="690" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">Cards, diagrams, and videos-as-code are the foundation.</text>
  <text x="1062" y="722" fill="#bfd0e4" font-size="22" font-family="Segoe UI, Arial, sans-serif">ComfyUI is an optional amplifier when needed.</text>
</svg>`;
}

function comfyPlaceholderMarkdown(): string {
  return `# Local ComfyUI status

This run does not require ComfyUI to generate the code-first asset pack.

ComfyUI remains preserved as an optional local generative backend for:

- realism-oriented image enhancement
- local image-to-video workflows
- future workflow inspection and mapping helpers

Current guidance:

- use code-rendered assets for exact layout, diagrams, banners, and structured videos
- use local ComfyUI only when visual richness or cinematic motion is actually needed
- keep generated assets and ComfyUI outputs side by side in inspectable run folders
`;
}

function longVideoNotesMarkdown(): string {
  return `# Longer video notes

This run includes a longer structured video render in addition to the short intro.

Manual review checklist:

- pacing should remain readable scene to scene
- title and body text should stay within safe margins
- scene accents should make the pipeline progression obvious
- the final summary should land on structure, local-first execution, and inspectable outputs

Recommended next refinement:

- introduce more scene-specific visual states so the long-form sequence feels less presentation-like and more editorial
`;
}

function relative(projectRoot: string, targetPath: string): string {
  return path.relative(projectRoot, targetPath).replace(/\\/g, '/');
}

async function validateFileExists(filePath: string): Promise<ValidationRecord> {
  try {
    const size = await fileSize(filePath);
    return { file: filePath, ok: size > 0, note: size > 0 ? `non-empty (${size} bytes)` : 'empty file' };
  } catch {
    return { file: filePath, ok: false, note: 'missing file' };
  }
}

async function validateSourceContains(filePath: string, expectedText: string[]): Promise<ValidationRecord[]> {
  const text = await readTextIfExists(filePath);
  if (text === null) {
    return [{ file: filePath, ok: false, note: 'source file missing for text validation' }];
  }
  return expectedText.map((fragment) => ({
    file: filePath,
    ok: text.includes(fragment),
    note: text.includes(fragment) ? `contains "${fragment}"` : `missing "${fragment}"`,
  }));
}

async function writeIndex(indexPath: string, entry: RunIndexEntry): Promise<void> {
  let entries: RunIndexEntry[] = [];
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as RunIndexEntry[];
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    entries = [];
  }
  entries.unshift(entry);
  await fs.writeFile(indexPath, `${JSON.stringify(entries.slice(0, 50), null, 2)}\n`, 'utf8');
}

async function copyStableExamples(projectRoot: string, sourceFiles: Array<{ src: string; dest: string }>): Promise<void> {
  const outDir = path.join(projectRoot, 'examples', 'generated-demo-assets');
  await ensureDir(outDir);
  for (const file of sourceFiles) {
    await fs.copyFile(file.src, path.join(outDir, file.dest));
  }
}

function cardRecord(id: string, category: string, title: string, primaryPath: string, secondaryPath: string, width: number, height: number): MediaAssetRecord {
  return {
    id,
    category,
    renderer: 'html_card',
    title,
    status: 'generated',
    primary_path: primaryPath,
    secondary_paths: [secondaryPath],
    width,
    height,
  };
}

function sceneRecord(id: string, category: string, title: string, primaryPath: string, secondaryPaths: string[], width: number, height: number): MediaAssetRecord {
  return {
    id,
    category,
    renderer: 'scene_graph',
    title,
    status: 'generated',
    primary_path: primaryPath,
    secondary_paths: secondaryPaths,
    width,
    height,
  };
}

export async function generateDemoAssetPack(
  projectRoot: string,
  options?: Parameters<typeof generateDemoAssetPackWithOptions>[1],
): Promise<MediaPipelineRunResult> {
  return generateDemoAssetPackWithOptions(projectRoot, options ?? {});
}

export async function generateDemoAssetPackWithOptions(
  projectRoot: string,
  options: {
    includeVideo?: boolean;
    outputRoot?: string;
    updateExamples?: boolean;
    referenceVideoPath?: string;
    referenceNotes?: string;
  },
): Promise<MediaPipelineRunResult> {
  const runId = makeRunId();
  const outputsRoot = options.outputRoot ? path.resolve(options.outputRoot) : path.join(projectRoot, 'outputs');
  const runDir = path.join(outputsRoot, 'runs', runId);
  const dirStatic = path.join(runDir, '01_static-launch-assets');
  const dirDiagrams = path.join(runDir, '02_pipeline-diagrams');
  const dirSocial = path.join(runDir, '03_social-cards');
  const dirVideo = path.join(runDir, '04_video-codegen');
  const dirComfy = path.join(runDir, '05_comfyui-placeholder-or-manual-test');
  const dirSceneGraph = path.join(runDir, '07_scene-graph-assets');
  const manifestPath = path.join(runDir, '00_manifest.md');
  const reportPath = path.join(runDir, '99_report.md');
  const indexPath = path.join(outputsRoot, 'index.json');

  await ensureDir(dirStatic);
  await ensureDir(dirDiagrams);
  await ensureDir(dirSocial);
  await ensureDir(dirVideo);
  await ensureDir(dirComfy);
  await ensureDir(dirSceneGraph);

  const assets: MediaAssetRecord[] = [];
  const skipped: string[] = [];
  const extraReportLines: string[] = [];

  const hero = await renderHtmlCard({
    template: 'project_hero_banner',
    title: PROJECT_TITLE,
    subtitle: PROJECT_SUBTITLE,
    eyebrow: 'Structure before randomness',
    badges: ['Code-first assets', 'Local-first runner', 'ComfyUI optional', 'Reproducible outputs'],
    bullets: [
      'Use exact renderers for hero banners, diagrams, social cards, and structured videos.',
      'Keep local ComfyUI as an optional richness backend instead of the foundation.',
      'Generate inspectable run folders with manifests, reports, and output indexing.',
    ],
    footer: 'Readable media runs, not one-off generated clutter.',
    output_name: 'hero-banner',
  }, dirStatic);
  assets.push(cardRecord('hero-banner', 'static-launch-assets', 'GitHub hero banner', hero.png_path, hero.svg_path, hero.width, hero.height));

  const feature = await renderHtmlCard({
    template: 'feature_overview_card',
    title: 'What works now',
    subtitle: 'A code-first pipeline for banners, diagrams, launch cards, output manifests, and structured video experiments.',
    eyebrow: 'Current capabilities',
    bullets: [
      'Professional PNG + SVG launch assets rendered from code.',
      'Organized output folders with manifests, reports, and run indexing.',
      'Local ComfyUI preserved as an optional generative backend.',
    ],
    badges: ['HTML/CSS cards', 'SVG diagrams', 'Remotion video', 'MCP bridge'],
    footer: 'Foundation first: precise media before optional model richness.',
    output_name: 'feature-overview-card',
  }, dirStatic);
  assets.push(cardRecord('feature-overview-card', 'static-launch-assets', 'Feature overview card', feature.png_path, feature.svg_path, feature.width, feature.height));

  const capability = await renderHtmlCard({
    template: 'capability_card',
    title: 'Works now vs planned later',
    subtitle: 'The project is honest about what is already reliable and what still belongs to future passes.',
    eyebrow: 'Capability / limitation card',
    bullets: [
      'Works now: code-rendered assets, run folders, manifests, reports, and local output indexing.',
      'Planned later: workflow mapping helpers, gallery UI, richer video systems, and optional BYOK cloud backends.',
      'Not included: SaaS hosting, CAD, 3D tooling, or mandatory paid APIs.',
    ],
    badges: ['Honest status', 'No hosted server', 'No required API key'],
    footer: 'Planned features stay clearly marked as planned.',
    output_name: 'capability-limitations-card',
  }, dirStatic);
  assets.push(cardRecord('capability-limitations-card', 'static-launch-assets', 'Capability / limitation card', capability.png_path, capability.svg_path, capability.width, capability.height));

  const pipelineDiagram = await saveSvgMarkup({
    svg_markup: pipelineDiagramSvg(),
    output_name: 'pipeline-diagram',
  }, dirDiagrams);
  assets.push({
    id: 'pipeline-diagram',
    category: 'pipeline-diagrams',
    renderer: 'svg_template',
    title: 'Pipeline diagram',
    status: 'generated',
    primary_path: pipelineDiagram.file_path,
    width: pipelineDiagram.width,
    height: pipelineDiagram.height,
  });

  const social = await renderHtmlCard({
    template: 'social_launch_card',
    title: 'Run structured media workflows from Claude',
    subtitle: 'Code-first. Local-first. Reproducible outputs.',
    eyebrow: 'Developer-tool launch card',
    badges: ['README-ready', 'Social-ready', 'No hosted server'],
    bullets: [
      'Generate cards, diagrams, and videos from code.',
      'Keep local outputs visible, organized, and easy to compare.',
    ],
    footer: 'Optional generative backends come later, on top of structure.',
    output_name: 'social-launch-card',
  }, dirSocial);
  assets.push(cardRecord('social-launch-card', 'social-cards', 'Social launch card', social.png_path, social.svg_path, social.width, social.height));

  if (options.includeVideo ?? true) {
    const shortVideoScenes: RemotionVideoInput['scenes'] = [
      { headline: 'Structure before randomness', body: 'Start with a media brief, an asset plan, and a renderer chosen for the job.', accent: 'Project philosophy' },
      { headline: 'Claude → local MCP runner', body: 'Claude or another agent can trigger deterministic renderers without needing a hosted service.', accent: 'Local-first' },
      { headline: 'Code renderers first', body: 'HTML/CSS cards, SVG diagrams, and video-as-code handle exact layout and messaging.', accent: 'Precise assets' },
      { headline: 'ComfyUI stays optional', body: 'Use local generative workflows when realism or cinematic richness is actually required.', accent: 'Optional backend' },
      { headline: 'Outputs, logs, gallery', body: 'Every run writes files, a manifest, and a report so the results stay inspectable.', accent: 'Inspectable outputs' },
    ];

    const shortVideo = await renderRemotionVideo({
      title: PROJECT_TITLE,
      subtitle: PROJECT_SUBTITLE,
      theme: 'slate',
      visual_style: 'pipeline_intro',
      scenes: shortVideoScenes,
      duration_seconds: 16,
      fps: 24,
      width: 1280,
      height: 720,
      output_name: 'project-intro-short',
    }, dirVideo);
    assets.push({
      id: 'project-intro-short',
      category: 'video-codegen',
      renderer: 'remotion_video',
      title: 'Short project intro video',
      status: 'generated',
      primary_path: shortVideo.file_path,
      width: shortVideo.width,
      height: shortVideo.height,
      notes: [`${shortVideo.duration_seconds}s at ${shortVideo.fps} fps`],
    });

    const longVideoScenes: RemotionVideoInput['scenes'] = [
      { headline: 'Random-first media often drifts', body: 'Without a plan, visuals become hard to compare, hard to reproduce, and hard to ship.', accent: 'Problem framing' },
      { headline: 'Start with the media brief', body: 'Define the asset purpose, audience, dimensions, and required message before choosing any backend.', accent: 'Scene 1' },
      { headline: 'Build the asset plan', body: 'Choose titles, subtitles, badges, diagrams, footage beats, and success criteria in a structured format.', accent: 'Scene 2' },
      { headline: 'Claude drives the local runner', body: 'The agent can request exact cards, diagrams, and videos through the MCP surface without needing a hosted service.', accent: 'Scene 3' },
      { headline: 'Code renderers handle precision', body: 'HTML/CSS cards, SVG diagrams, and Remotion sequences keep layout and copy deterministic.', accent: 'Scene 4' },
      { headline: 'ComfyUI is optional richness', body: 'Local generative workflows stay available when realism or cinematic motion is needed, but they do not replace structure.', accent: 'Scene 5' },
      { headline: 'Every run becomes inspectable', body: 'Outputs, manifests, reports, and indexes land in a predictable folder structure for review and comparison.', accent: 'Scene 6' },
      { headline: 'Works now vs later stays honest', body: 'The pipeline can clearly separate shipped capability from future experiments instead of overclaiming.', accent: 'Scene 7' },
      { headline: 'Structure before randomness', body: 'The end goal is a stable local-first structured media runner where exact assets and optional model richness can coexist cleanly.', accent: 'Final summary' },
    ];

    const longVideo = await renderRemotionVideo({
      title: `${PROJECT_TITLE} • Long-form demo`,
      subtitle: 'Code-first generation, optional local ComfyUI, and inspectable outputs.',
      theme: 'ocean',
      visual_style: 'pipeline_intro',
      scenes: longVideoScenes,
      duration_seconds: 72,
      fps: 24,
      width: 1280,
      height: 720,
      output_name: 'project-demo-long',
    }, dirVideo);
    assets.push({
      id: 'project-demo-long',
      category: 'video-codegen',
      renderer: 'remotion_video',
      title: 'Longer structured demo video',
      status: 'generated',
      primary_path: longVideo.file_path,
      width: longVideo.width,
      height: longVideo.height,
      notes: [`${longVideo.duration_seconds}s at ${longVideo.fps} fps`],
    });
  } else {
    skipped.push('Short code-generated video skipped for this run by option.');
  }

  const longVideoNotesPath = path.join(dirVideo, 'long-video-notes.md');
  await fs.writeFile(longVideoNotesPath, `${longVideoNotesMarkdown()}\n`, 'utf8');

  const comfyNotePath = path.join(dirComfy, 'manual-test-notes.md');
  await fs.writeFile(comfyNotePath, `${comfyPlaceholderMarkdown()}\n`, 'utf8');
  assets.push({
    id: 'comfyui-manual-note',
    category: 'comfyui-placeholder-or-manual-test',
    renderer: 'manual_note',
    title: 'ComfyUI manual test note',
    status: 'generated',
    primary_path: comfyNotePath,
  });

  const sceneGraphHero = await renderSvgScene({
    scene: buildSceneGraphHeroSpec(),
    output_name: 'scene-graph-hero',
  }, dirSceneGraph);
  assets.push(sceneRecord(
    'scene-graph-hero',
    'scene-graph-assets',
    'Scene graph hero board',
    sceneGraphHero.png_path ?? sceneGraphHero.svg_path,
    [sceneGraphHero.svg_path].filter((file) => file !== (sceneGraphHero.png_path ?? sceneGraphHero.svg_path)),
    sceneGraphHero.width,
    sceneGraphHero.height,
  ));

  const sceneGraphTimeline = await renderSvgScene({
    scene: buildSceneGraphTimelineSpec(),
    output_name: 'scene-graph-timeline',
  }, dirSceneGraph);
  assets.push(sceneRecord(
    'scene-graph-timeline',
    'scene-graph-assets',
    'Scene graph timeline board',
    sceneGraphTimeline.png_path ?? sceneGraphTimeline.svg_path,
    [sceneGraphTimeline.svg_path].filter((file) => file !== (sceneGraphTimeline.png_path ?? sceneGraphTimeline.svg_path)),
    sceneGraphTimeline.width,
    sceneGraphTimeline.height,
  ));

  const sceneSequence = await renderSvgSceneVideo({
    title: 'Scene graph sequence',
    subtitle: 'SVG scenes rendered from structured code and sequenced into video.',
    theme: 'slate',
    scenes: buildSceneSequenceSpecs().map((scene, index) => ({
      scene,
      headline: index === 0 ? 'Scene graph hero' : index === 1 ? 'Multi-output system' : 'Timing as code',
      body: index === 0
        ? 'A precise scene spec can define a full hero image without hand-writing each asset variant.'
        : index === 1
          ? 'The same visual grammar can expand into diagrams, boards, and review surfaces.'
          : 'The video layer can reuse SVG scenes directly and keep timing deterministic.',
      accent: `Scene ${String(index + 1).padStart(2, '0')}`,
      duration_seconds: index === 1 ? 5.5 : 4.25,
    })),
    width: 1280,
    height: 720,
    fps: 24,
    output_name: 'scene-graph-sequence',
  }, dirSceneGraph);
  assets.push({
    id: 'scene-graph-sequence',
    category: 'scene-graph-assets',
    renderer: 'remotion_video',
    title: 'Scene graph sequence video',
    status: 'generated',
    primary_path: sceneSequence.file_path,
    width: sceneSequence.width,
    height: sceneSequence.height,
    notes: [`${sceneSequence.duration_seconds}s at ${sceneSequence.fps} fps`],
  });

  const validations: ValidationRecord[] = [];

  if (options.referenceVideoPath) {
    const treatment = await generateCinematicTreatmentPack({
      projectRoot,
      runDir,
      referenceVideoPath: options.referenceVideoPath,
      notes: options.referenceNotes,
    });
    assets.push(...treatment.assets);
    validations.push(await validateFileExists(treatment.manifest_path));
    validations.push(await validateFileExists(treatment.report_path));
    for (const asset of treatment.assets) {
      validations.push(await validateFileExists(asset.primary_path));
      for (const extra of asset.secondary_paths ?? []) {
        validations.push(await validateFileExists(extra));
      }
    }
    extraReportLines.push('');
    extraReportLines.push('## Cinematic treatment layer');
    extraReportLines.push('');
    extraReportLines.push('- A reference-driven treatment pack was generated in `06_cinematic-treatment/`.');
    extraReportLines.push('- This adds real frame study, a shot board, and a more editorial preview video instead of relying only on generic presentation visuals.');
    extraReportLines.push('- It is still a planning / precision layer, not a claim of final photoreal generation by itself.');
  } else {
    skipped.push('Reference-driven cinematic treatment pack skipped because no reference video path was supplied.');
  }

  for (const asset of assets) {
    validations.push(await validateFileExists(asset.primary_path));
    for (const extra of asset.secondary_paths ?? []) {
      validations.push(await validateFileExists(extra));
    }
  }
  validations.push(await validateFileExists(longVideoNotesPath));
  validations.push(await validateFileExists(comfyNotePath));

  validations.push(...await validateSourceContains(hero.svg_path, [PROJECT_TITLE, 'Structure before randomness']));
  validations.push(...await validateSourceContains(feature.svg_path, ['What works now', 'HTML/CSS cards']));
  validations.push(...await validateSourceContains(capability.svg_path, ['Works now vs planned later', 'No hosted server']));
  validations.push(...await validateSourceContains(social.svg_path, ['Run structured media workflows from Claude', 'Code-first. Local-first. Reproducible outputs.']));
  validations.push(...await validateSourceContains(pipelineDiagram.file_path, ['Structured local media pipeline', 'Local ComfyUI']));
  validations.push(...await validateSourceContains(sceneGraphHero.svg_path, ['Every image can be described as structured SVG code', 'SCENE GRAPH CODEGEN']));
  validations.push(...await validateSourceContains(sceneGraphTimeline.svg_path, ['One scene graph, many outputs', 'SCENE SYSTEM']));

  const validationFailures = validations.filter((item) => !item.ok);
  if (validationFailures.length > 0) {
    const summary = validationFailures.map((item) => `${relative(projectRoot, item.file)}: ${item.note}`).join('; ');
    throw new Error(`Media pipeline validation failed. Cause: ${summary}. Suggested fix: inspect the generated run folder and adjust the renderer/template content.`);
  }

  const gitDescriptor = await getGitDescriptor(projectRoot);
  const manifestLines = [
    '# Media run manifest',
    '',
    `- Run timestamp: ${new Date().toISOString()}`,
    `- Run id: \`${runId}\``,
    `- Git: ${gitDescriptor}`,
    `- Project: ${PROJECT_TITLE}`,
    '',
    '## Generated assets',
    '',
    ...assets.map((asset) => `- ${asset.title} (${asset.renderer}) -> \`${relative(projectRoot, asset.primary_path)}\`${asset.secondary_paths?.length ? ` plus ${asset.secondary_paths.map((file) => `\`${relative(projectRoot, file)}\``).join(', ')}` : ''}`),
    '',
    '## Validation',
    '',
    ...validations.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'}: \`${relative(projectRoot, item.file)}\` - ${item.note}`),
    '',
    '## Known limitations',
    '',
    '- The visuals are still template-driven rather than fully art-directed brand work.',
    '- Visual quality still depends on template craftsmanship and human review; no automatic aesthetic scoring is claimed.',
    '- Local ComfyUI remains optional and may still need model/runtime tuning for heavy workflows.',
    '',
    '## Next suggested test',
    '',
    '- Review the new gallery page and refine the long-form video with more scene-specific motion language.',
  ];
  await fs.writeFile(manifestPath, `${manifestLines.join('\n')}\n`, 'utf8');

  const reportLines = [
    '# Media pipeline report',
    '',
    '## Summary',
    '',
    'This run demonstrates the corrected project direction: code-first structured media generation with organized outputs, readable manifests, and launch-oriented visuals.',
    '',
    '## What was generated',
    '',
    '- Static launch assets: hero banner, feature overview card, capability / limitation card.',
    '- Diagrammatic assets: one pipeline architecture diagram.',
    '- Social asset: one launch card for README / Reddit / X / LinkedIn sharing.',
    '- Video assets: one short intro and one longer structured demo rendered from code.',
    '- Scene graph assets: two SVG-defined boards plus one video built from SVG scenes.',
    '- Operational notes: one ComfyUI placeholder/manual-test note and one long-video review note.',
    '',
    '## What looks good',
    '',
    '- The hero banner and social launch card now communicate the project clearly without leaning on the old household-robot theme.',
    '- The pipeline diagram explains the local-first architecture and the role of optional ComfyUI cleanly.',
    '- The short and long videos both stay project-centric and explain the pipeline rather than showing unrelated character art.',
    '- The run index can now drive a local gallery page for browsing recent media runs.',
    '- The scene graph assets prove that stills and video scenes can come from the same structural SVG description layer.',
    '',
    '## What still looks weak',
    '',
    '- The visuals are professional developer-tool assets, but they are still template-driven rather than fully art-directed brand design.',
    '- The long-form video is intentionally controlled more like a product explainer than a cinematic film piece.',
    '- The gallery is a static local page, not an interactive application yet.',
    '',
    '## Renderer mapping',
    '',
    '- HTML/CSS-style renderer: hero banner, feature overview card, capability card, social card.',
    '- SVG renderer: pipeline diagram.',
    '- Scene graph renderer: structured SVG boards and SVG-driven scene sequence video.',
    '- Remotion video renderer: short intro, longer structured demo video, plus scene sequence playback.',
    '- Manual note: ComfyUI placeholder/manual-test guidance.',
    '',
    '## Suitable for README / social use',
    '',
    '- `01_static-launch-assets/hero-banner.png`',
    '- `02_pipeline-diagrams/pipeline-diagram.svg`',
    '- `03_social-cards/social-launch-card.png`',
    '- `07_scene-graph-assets/scene-graph-hero.png`',
    '',
    '## Technical demos only',
    '',
    '- `04_video-codegen/long-video-notes.md`',
    '- `05_comfyui-placeholder-or-manual-test/manual-test-notes.md`',
    ...extraReportLines,
    '',
    '## Next pass recommendation',
    '',
    '- Add a richer gallery UX and give the long-form video more visual state changes between scenes.',
  ];
  await fs.writeFile(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  await ensureDir(outputsRoot);
  await writeIndex(indexPath, {
    run_id: runId,
    timestamp: new Date().toISOString(),
    run_dir: runDir,
    manifest_path: manifestPath,
    report_path: reportPath,
    assets_count: assets.length,
    video_count: assets.filter((asset) => asset.renderer === 'remotion_video').length,
    status: 'completed',
    featured_assets: [
      { title: 'Hero banner', path: hero.png_path, kind: 'image' },
      { title: 'Pipeline diagram', path: pipelineDiagram.file_path, kind: 'image' },
      { title: 'Social launch card', path: social.png_path, kind: 'image' },
      ...assets
        .filter((asset) => asset.renderer === 'remotion_video')
        .map((asset) => ({ title: asset.title, path: asset.primary_path, kind: 'video' as const })),
      { title: 'Run report', path: reportPath, kind: 'document' },
    ],
  });

  const gallery = await generateOutputGallery(outputsRoot);

  if (options.updateExamples ?? true) {
    await copyStableExamples(projectRoot, [
      { src: hero.svg_path, dest: 'hero-banner.svg' },
      { src: pipelineDiagram.file_path, dest: 'pipeline-diagram.svg' },
      { src: social.svg_path, dest: 'social-launch-card.svg' },
      { src: feature.svg_path, dest: 'feature-overview-card.svg' },
      { src: capability.svg_path, dest: 'capability-limitations-card.svg' },
      { src: longVideoNotesPath, dest: 'short-video-notes.md' },
    ]);

    const examplesReadme = [
      '# Generated demo assets',
      '',
      'This folder keeps lightweight committed samples from the code-first media pipeline.',
      '',
      'Included here:',
      '',
      '- `hero-banner.svg`',
      '- `pipeline-diagram.svg`',
      '- `social-launch-card.svg`',
      '- `feature-overview-card.svg`',
      '- `capability-limitations-card.svg`',
      '- `short-video-notes.md`',
      '',
      'For the latest PNG and MP4 outputs, run `npm run media:demo` and inspect the newest folder in `outputs/runs/` or open `outputs/gallery/index.html`.',
    ];
    await fs.writeFile(path.join(projectRoot, 'examples', 'generated-demo-assets', 'README.md'), `${examplesReadme.join('\n')}\n`, 'utf8');
  }

  return {
    run_id: sanitizeFileStem(runId.replace(/_/g, '-')),
    run_dir: runDir,
    manifest_path: manifestPath,
    report_path: reportPath,
    index_path: indexPath,
    gallery_path: gallery.html_path,
    assets,
    skipped,
  };
}
