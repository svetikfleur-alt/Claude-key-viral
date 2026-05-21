import fs from 'node:fs/promises';
import path from 'node:path';
import type { MediaAssetRecord, MediaPipelineRunResult, SvgSceneSpec, SvgSceneVideoInput } from '../types.js';
import { renderSvgScene, renderSvgSceneVideo } from '../codegen/sceneDslRenderer.js';
import { generateOutputGallery } from './outputGallery.js';

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

async function validateFileExists(filePath: string): Promise<ValidationRecord> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      return { file: filePath, ok: false, note: 'empty or not a file' };
    }
    return { file: filePath, ok: true, note: `non-empty (${stat.size} bytes)` };
  } catch (error: unknown) {
    return { file: filePath, ok: false, note: `missing (${(error as Error).message})` };
  }
}

function assetRecord(id: string, category: string, title: string, primary: string, secondary: string[] | undefined, width: number, height: number): MediaAssetRecord {
  return {
    id,
    category,
    renderer: 'scene_graph',
    title,
    status: 'generated',
    primary_path: primary,
    secondary_paths: secondary,
    width,
    height,
  };
}

function baseDefs() {
  return {
    gradients: [
      {
        id: 'bg',
        type: 'linear' as const,
        x1: '0%',
        y1: '0%',
        x2: '100%',
        y2: '100%',
        stops: [
          { offset: '0%', color: '#050b16' },
          { offset: '55%', color: '#081426' },
          { offset: '100%', color: '#10233a' },
        ],
      },
      {
        id: 'orb',
        type: 'radial' as const,
        cx: '50%',
        cy: '50%',
        r: '60%',
        stops: [
          { offset: '0%', color: '#7dd3fc', opacity: 0.38 },
          { offset: '62%', color: '#38bdf8', opacity: 0.12 },
          { offset: '100%', color: '#0f172a', opacity: 0 },
        ],
      },
    ],
    filters: [
      { id: 'shadow', type: 'drop_shadow' as const, dx: 0, dy: 18, std_deviation: 22, color: '#020617', opacity: 0.5 },
      { id: 'glow', type: 'drop_shadow' as const, dx: 0, dy: 0, std_deviation: 16, color: '#38bdf8', opacity: 0.36 },
    ],
  };
}

function uiScene(): SvgSceneSpec {
  return {
    width: 1600,
    height: 900,
    background: 'url(#bg)',
    defs: baseDefs(),
    nodes: [
      { kind: 'circle', cx: 1220, cy: 160, r: 360, fill: 'url(#orb)', opacity: 0.8 },
      { kind: 'rect', x: 54, y: 54, width: 1492, height: 792, radius: 34, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 96, y: 112, width: 700, text: 'UI / Product Screen', font_size: 18, font_weight: 700, letter_spacing: 2.2, fill: '#7dd3fc' },
      { kind: 'text', x: 96, y: 156, width: 840, text: 'Structured scene graphs can render real UI layouts', font_size: 56, font_weight: 760, fill: '#f8fafc', line_height: 1.02 },
      { kind: 'text', x: 96, y: 344, width: 720, text: 'Panels, nav, charts, badges, and typography are deterministic and reviewable.', font_size: 26, fill: '#c7d7ea', line_height: 1.36 },

      { kind: 'rect', x: 96, y: 430, width: 420, height: 340, radius: 26, fill: 'rgba(8, 16, 30, 0.86)', stroke: 'rgba(125,211,252,0.16)', filter: 'shadow' },
      { kind: 'text', x: 130, y: 476, width: 352, text: 'Queue', font_size: 28, font_weight: 740, fill: '#f8fafc' },
      { kind: 'rect', x: 130, y: 508, width: 352, height: 1, fill: 'rgba(148,163,184,0.2)' },
      { kind: 'rect', x: 130, y: 536, width: 352, height: 64, radius: 18, fill: 'rgba(15, 23, 42, 0.92)', stroke: 'rgba(125,211,252,0.14)' },
      { kind: 'text', x: 156, y: 560, width: 280, text: 'Render hero banner', font_size: 20, font_weight: 650, fill: '#e2e8f0' },
      { kind: 'text', x: 156, y: 586, width: 280, text: 'scene_graph • png', font_size: 16, fill: '#86efac' },
      { kind: 'rect', x: 130, y: 612, width: 352, height: 64, radius: 18, fill: 'rgba(15, 23, 42, 0.92)', stroke: 'rgba(125,211,252,0.14)' },
      { kind: 'text', x: 156, y: 636, width: 280, text: 'Generate storyboard board', font_size: 20, font_weight: 650, fill: '#e2e8f0' },
      { kind: 'text', x: 156, y: 662, width: 280, text: 'scene_graph • svg', font_size: 16, fill: '#93c5fd' },
      { kind: 'rect', x: 130, y: 688, width: 352, height: 64, radius: 18, fill: 'rgba(15, 23, 42, 0.92)', stroke: 'rgba(125,211,252,0.14)' },
      { kind: 'text', x: 156, y: 712, width: 280, text: 'Assemble scene-sequence video', font_size: 20, font_weight: 650, fill: '#e2e8f0' },
      { kind: 'text', x: 156, y: 738, width: 280, text: 'remotion • mp4', font_size: 16, fill: '#facc15' },

      { kind: 'rect', x: 560, y: 430, width: 946, height: 340, radius: 26, fill: 'rgba(8, 16, 30, 0.86)', stroke: 'rgba(125,211,252,0.16)', filter: 'shadow' },
      { kind: 'text', x: 596, y: 476, width: 520, text: 'Signals', font_size: 28, font_weight: 740, fill: '#f8fafc' },
      { kind: 'path', d: 'M596 728 C 720 650, 812 760, 940 692 C 1030 646, 1110 604, 1220 644 C 1320 682, 1400 624, 1506 602', stroke: 'rgba(125,211,252,0.62)', stroke_width: 6, stroke_linecap: 'round', fill: 'none' },
      { kind: 'path', d: 'M596 704 C 720 636, 814 714, 940 668 C 1048 628, 1110 586, 1220 622 C 1320 658, 1408 612, 1506 580', stroke: 'rgba(134,239,172,0.42)', stroke_width: 4, stroke_linecap: 'round', fill: 'none' },
      { kind: 'rect', x: 596, y: 510, width: 876, height: 166, radius: 22, fill: 'rgba(15,23,42,0.82)', stroke: 'rgba(148,163,184,0.18)' },
      { kind: 'text', x: 630, y: 548, width: 820, text: 'This chart is vector, deterministic, and still looks “alive”.', font_size: 22, fill: '#cbd5e1' },
      { kind: 'text', x: 630, y: 586, width: 820, text: 'Use it for dashboards, thumbnails, and review surfaces.', font_size: 20, fill: '#94a3b8' },
    ],
  };
}

function systemDiagramScene(): SvgSceneSpec {
  return {
    width: 1600,
    height: 900,
    background: 'url(#bg)',
    defs: baseDefs(),
    nodes: [
      { kind: 'circle', cx: 320, cy: 220, r: 340, fill: 'url(#orb)', opacity: 0.6 },
      { kind: 'rect', x: 54, y: 54, width: 1492, height: 792, radius: 34, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 96, y: 120, width: 720, text: 'System Diagram', font_size: 18, font_weight: 700, letter_spacing: 2.2, fill: '#7dd3fc' },
      { kind: 'text', x: 96, y: 168, width: 980, text: 'Connectors, labels, and constraints stay inspectable', font_size: 54, font_weight: 760, fill: '#f8fafc', line_height: 1.04 },

      { kind: 'rect', x: 140, y: 300, width: 360, height: 150, radius: 28, fill: 'rgba(8, 16, 30, 0.88)', stroke: 'rgba(125,211,252,0.18)', filter: 'shadow' },
      { kind: 'text', x: 182, y: 354, width: 300, text: 'Claude Desktop', font_size: 28, font_weight: 740, fill: '#f8fafc' },
      { kind: 'text', x: 182, y: 392, width: 300, text: 'MCP client', font_size: 20, fill: '#c7d7ea' },

      { kind: 'rect', x: 620, y: 280, width: 420, height: 190, radius: 28, fill: 'rgba(8, 16, 30, 0.9)', stroke: 'rgba(147,197,253,0.2)', filter: 'shadow' },
      { kind: 'text', x: 662, y: 340, width: 340, text: 'Local MCP Runner', font_size: 30, font_weight: 760, fill: '#f8fafc' },
      { kind: 'text', x: 662, y: 380, width: 360, text: 'Render • validate • index', font_size: 20, fill: '#c7d7ea' },
      { kind: 'rect', x: 662, y: 408, width: 110, height: 32, radius: 12, fill: 'rgba(15,23,42,0.9)', stroke: 'rgba(125,211,252,0.2)' },
      { kind: 'text', x: 684, y: 430, width: 100, text: 'local', font_size: 16, font_weight: 700, fill: '#86efac' },

      { kind: 'rect', x: 1140, y: 270, width: 400, height: 210, radius: 28, fill: 'rgba(8, 16, 30, 0.92)', stroke: 'rgba(134,239,172,0.22)', filter: 'shadow' },
      { kind: 'text', x: 1182, y: 332, width: 320, text: 'Code Renderers', font_size: 28, font_weight: 760, fill: '#f8fafc' },
      { kind: 'text', x: 1182, y: 372, width: 340, text: 'SVG • HTML/CSS • Video', font_size: 20, fill: '#c7d7ea' },

      { kind: 'rect', x: 1140, y: 520, width: 400, height: 210, radius: 28, fill: 'rgba(8, 16, 30, 0.92)', stroke: 'rgba(250,204,21,0.22)', filter: 'shadow' },
      { kind: 'text', x: 1182, y: 582, width: 320, text: 'Local ComfyUI', font_size: 28, font_weight: 760, fill: '#f8fafc' },
      { kind: 'text', x: 1182, y: 622, width: 340, text: 'Optional richness backend', font_size: 20, fill: '#c7d7ea' },

      { kind: 'rect', x: 620, y: 560, width: 420, height: 160, radius: 28, fill: 'rgba(8,16,30,0.92)', stroke: 'rgba(125,211,252,0.18)', filter: 'shadow' },
      { kind: 'text', x: 662, y: 622, width: 340, text: 'Outputs', font_size: 28, font_weight: 760, fill: '#f8fafc' },
      { kind: 'text', x: 662, y: 662, width: 360, text: 'runs • manifests • gallery', font_size: 20, fill: '#c7d7ea' },

      { kind: 'path', d: 'M500 372 C560 372 570 372 620 372', stroke: 'rgba(125,211,252,0.7)', stroke_width: 6, stroke_linecap: 'round', fill: 'none' },
      { kind: 'path', d: 'M1040 372 C1100 372 1110 372 1140 372', stroke: 'rgba(134,239,172,0.55)', stroke_width: 6, stroke_linecap: 'round', fill: 'none' },
      { kind: 'path', d: 'M1040 372 C1100 372 1110 624 1140 624', stroke: 'rgba(250,204,21,0.4)', stroke_width: 6, stroke_linecap: 'round', fill: 'none' },
      { kind: 'path', d: 'M830 470 C830 520 830 520 830 560', stroke: 'rgba(125,211,252,0.55)', stroke_width: 6, stroke_linecap: 'round', fill: 'none' },
    ],
  };
}

function dataVizScene(): SvgSceneSpec {
  const bars = Array.from({ length: 10 }, (_, index) => {
    const height = 40 + (index % 5) * 34;
    return { kind: 'rect' as const, x: 220 + index * 96, y: 700 - height, width: 54, height, radius: 14, fill: index % 3 === 0 ? 'rgba(125,211,252,0.8)' : 'rgba(148,163,184,0.28)' };
  });

  return {
    width: 1600,
    height: 900,
    background: 'url(#bg)',
    defs: baseDefs(),
    nodes: [
      { kind: 'circle', cx: 1320, cy: 720, r: 360, fill: 'url(#orb)', opacity: 0.35 },
      { kind: 'rect', x: 54, y: 54, width: 1492, height: 792, radius: 34, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 96, y: 120, width: 720, text: 'Data Visualization', font_size: 18, font_weight: 700, letter_spacing: 2.2, fill: '#7dd3fc' },
      { kind: 'text', x: 96, y: 168, width: 980, text: 'Charts can be authored as precise vector scenes', font_size: 54, font_weight: 760, fill: '#f8fafc', line_height: 1.04 },
      { kind: 'rect', x: 96, y: 260, width: 1408, height: 560, radius: 30, fill: 'rgba(8,16,30,0.84)', stroke: 'rgba(148,163,184,0.18)', filter: 'shadow' },
      { kind: 'text', x: 140, y: 314, width: 520, text: 'Throughput by stage', font_size: 28, font_weight: 740, fill: '#f8fafc' },
      { kind: 'text', x: 140, y: 354, width: 720, text: 'Not “AI vibes”. Just deterministic geometry and typography.', font_size: 20, fill: '#c7d7ea' },
      { kind: 'line', x1: 180, y1: 700, x2: 1480, y2: 700, stroke: 'rgba(148,163,184,0.28)', stroke_width: 2 },
      ...bars,
      { kind: 'path', d: 'M220 612 C 320 560, 430 638, 520 594 C 620 546, 710 480, 820 516 C 930 554, 1040 442, 1140 470 C 1260 504, 1360 414, 1480 446', stroke: 'rgba(134,239,172,0.65)', stroke_width: 6, stroke_linecap: 'round', fill: 'none' },
    ],
  };
}

function mapScene(): SvgSceneSpec {
  return {
    width: 1600,
    height: 900,
    background: 'url(#bg)',
    defs: baseDefs(),
    nodes: [
      { kind: 'rect', x: 54, y: 54, width: 1492, height: 792, radius: 34, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 96, y: 120, width: 720, text: 'Map / Route Layout', font_size: 18, font_weight: 700, letter_spacing: 2.2, fill: '#7dd3fc' },
      { kind: 'text', x: 96, y: 168, width: 1020, text: 'Polygons + paths can build technical “map” scenes', font_size: 54, font_weight: 760, fill: '#f8fafc', line_height: 1.04 },

      { kind: 'rect', x: 96, y: 260, width: 1408, height: 560, radius: 30, fill: 'rgba(8,16,30,0.84)', stroke: 'rgba(148,163,184,0.18)', filter: 'shadow' },
      { kind: 'polygon', points: '160,330 520,300 650,460 510,610 220,590', fill: 'rgba(125,211,252,0.08)', stroke: 'rgba(125,211,252,0.16)' },
      { kind: 'polygon', points: '640,340 1020,320 1180,510 980,670 700,620', fill: 'rgba(134,239,172,0.06)', stroke: 'rgba(134,239,172,0.14)' },
      { kind: 'polygon', points: '1060,360 1440,420 1420,700 1120,720 1030,520', fill: 'rgba(250,204,21,0.05)', stroke: 'rgba(250,204,21,0.12)' },
      { kind: 'path', d: 'M220 560 C 420 420, 560 690, 740 520 C 920 350, 1100 520, 1320 440', stroke: 'rgba(125,211,252,0.75)', stroke_width: 8, stroke_linecap: 'round', fill: 'none' },
      { kind: 'circle', cx: 220, cy: 560, r: 14, fill: '#7dd3fc', filter: 'glow' },
      { kind: 'circle', cx: 740, cy: 520, r: 14, fill: '#86efac', filter: 'glow' },
      { kind: 'circle', cx: 1320, cy: 440, r: 14, fill: '#facc15', filter: 'glow' },
      { kind: 'text', x: 244, y: 546, width: 240, text: 'Start', font_size: 18, font_weight: 700, fill: '#e2e8f0' },
      { kind: 'text', x: 764, y: 506, width: 240, text: 'Checkpoint', font_size: 18, font_weight: 700, fill: '#e2e8f0' },
      { kind: 'text', x: 1344, y: 426, width: 240, text: 'Output', font_size: 18, font_weight: 700, fill: '#e2e8f0' },
    ],
  };
}

function posterScene(): SvgSceneSpec {
  return {
    width: 1600,
    height: 900,
    background: 'url(#bg)',
    defs: baseDefs(),
    nodes: [
      { kind: 'circle', cx: 1320, cy: 160, r: 400, fill: 'url(#orb)', opacity: 0.9 },
      { kind: 'rect', x: 54, y: 54, width: 1492, height: 792, radius: 34, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 96, y: 132, width: 800, text: 'Editorial Poster', font_size: 18, font_weight: 700, letter_spacing: 2.2, fill: '#7dd3fc' },
      { kind: 'text', x: 96, y: 200, width: 980, text: 'Structure before randomness', font_size: 92, font_weight: 800, fill: '#f8fafc', line_height: 0.96 },
      { kind: 'text', x: 96, y: 412, width: 820, text: 'A scene graph is a reusable visual grammar, not a one-off illustration.', font_size: 28, fill: '#c7d7ea', line_height: 1.3 },
      { kind: 'rect', x: 96, y: 520, width: 560, height: 210, radius: 30, fill: 'rgba(8,16,30,0.78)', stroke: 'rgba(148,163,184,0.18)', filter: 'shadow' },
      { kind: 'text', x: 140, y: 582, width: 480, text: 'Use cases', font_size: 26, font_weight: 760, fill: '#f8fafc' },
      { kind: 'text', x: 140, y: 624, width: 480, text: '• README graphics\n• diagrams\n• storyboards\n• code videos', font_size: 22, fill: '#cbd5e1', line_height: 1.46 },
      { kind: 'path', d: 'M820 610 C 980 460, 1100 700, 1480 520', stroke: 'rgba(125,211,252,0.45)', stroke_width: 5, stroke_linecap: 'round', fill: 'none' },
      { kind: 'path', d: 'M830 680 C 1000 580, 1160 740, 1490 610', stroke: 'rgba(134,239,172,0.28)', stroke_width: 4, stroke_linecap: 'round', fill: 'none' },
    ],
  };
}

function codeScene(): SvgSceneSpec {
  const mono = "uiScene := stack(\\n  header('Scene graphs'),\\n  chart(sparkline),\\n  footer('validated')\\n)\\nrender(uiScene) -> svg + png";
  return {
    width: 1600,
    height: 900,
    background: 'url(#bg)',
    defs: baseDefs(),
    nodes: [
      { kind: 'rect', x: 54, y: 54, width: 1492, height: 792, radius: 34, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 96, y: 120, width: 720, text: 'Code / Spec View', font_size: 18, font_weight: 700, letter_spacing: 2.2, fill: '#7dd3fc' },
      { kind: 'text', x: 96, y: 168, width: 1020, text: 'Scenes are authored like code, not drawn by hand', font_size: 54, font_weight: 760, fill: '#f8fafc', line_height: 1.04 },
      { kind: 'rect', x: 96, y: 290, width: 1408, height: 520, radius: 30, fill: 'rgba(8,16,30,0.86)', stroke: 'rgba(148,163,184,0.18)', filter: 'shadow' },
      { kind: 'rect', x: 96, y: 290, width: 1408, height: 54, radius: 30, fill: 'rgba(2,6,23,0.68)', stroke: 'rgba(148,163,184,0.14)' },
      { kind: 'circle', cx: 132, cy: 318, r: 7, fill: '#fb7185' },
      { kind: 'circle', cx: 156, cy: 318, r: 7, fill: '#facc15' },
      { kind: 'circle', cx: 180, cy: 318, r: 7, fill: '#86efac' },
      { kind: 'text', x: 220, y: 304, width: 860, text: 'scene-spec.dsl', font_size: 18, font_weight: 650, fill: '#cbd5e1', font_family: 'Consolas, ui-monospace, Menlo, Monaco, monospace' },
      { kind: 'text', x: 140, y: 382, width: 1300, text: mono, font_size: 26, fill: '#e2e8f0', line_height: 1.42, font_family: 'Consolas, ui-monospace, Menlo, Monaco, monospace' },
      { kind: 'rect', x: 96, y: 820, width: 1408, height: 1, fill: 'rgba(148,163,184,0.18)' },
    ],
  };
}

function storyboardScene(): SvgSceneSpec {
  return {
    width: 1600,
    height: 900,
    background: 'url(#bg)',
    defs: baseDefs(),
    nodes: [
      { kind: 'rect', x: 54, y: 54, width: 1492, height: 792, radius: 34, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 96, y: 120, width: 720, text: 'Storyboard Board', font_size: 18, font_weight: 700, letter_spacing: 2.2, fill: '#7dd3fc' },
      { kind: 'text', x: 96, y: 168, width: 1080, text: 'A storyboard is just a constrained scene layout', font_size: 54, font_weight: 760, fill: '#f8fafc', line_height: 1.04 },
      { kind: 'text', x: 96, y: 248, width: 860, text: 'Use it for video planning, shot lists, and review surfaces.', font_size: 24, fill: '#c7d7ea', line_height: 1.36 },

      { kind: 'rect', x: 96, y: 308, width: 1408, height: 512, radius: 30, fill: 'rgba(8,16,30,0.86)', stroke: 'rgba(148,163,184,0.18)', filter: 'shadow' },
      ...Array.from({ length: 6 }, (_, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const x = 132 + col * 470;
        const y = 348 + row * 236;
        return [
          { kind: 'rect' as const, x, y, width: 430, height: 178, radius: 22, fill: 'rgba(2,6,23,0.58)', stroke: 'rgba(125,211,252,0.14)' },
          { kind: 'path' as const, d: `M${x + 46} ${y + 126} C ${x + 160} ${y + 48}, ${x + 300} ${y + 216}, ${x + 384} ${y + 78}`, stroke: 'rgba(125,211,252,0.34)', stroke_width: 4, stroke_linecap: 'round' as const, fill: 'none' },
          { kind: 'text' as const, x: x + 22, y: y + 22, width: 390, text: `SHOT ${String(index + 1).padStart(2, '0')}`, font_size: 16, font_weight: 800, fill: '#93c5fd', letter_spacing: 2.2 },
          { kind: 'text' as const, x: x + 22, y: y + 48, width: 390, text: row === 0 ? 'Setup / framing' : 'Payoff / motion', font_size: 18, fill: '#cbd5e1' },
        ];
      }).flat(),
    ],
  };
}

function scenarioList(): Array<{ id: string; title: string; scene: SvgSceneSpec }> {
  return [
    { id: '01_ui', title: 'UI product screen', scene: uiScene() },
    { id: '02_system-diagram', title: 'System diagram', scene: systemDiagramScene() },
    { id: '03_data-viz', title: 'Data visualization', scene: dataVizScene() },
    { id: '04_map-route', title: 'Map / route layout', scene: mapScene() },
    { id: '05_editorial-poster', title: 'Editorial poster', scene: posterScene() },
    { id: '06_code-spec', title: 'Code/spec view', scene: codeScene() },
    { id: '07_storyboard', title: 'Storyboard board', scene: storyboardScene() },
  ];
}

function scenarioSequenceVideoInput(scenarios: ReturnType<typeof scenarioList>): SvgSceneVideoInput {
  const scenes: SvgSceneVideoInput['scenes'] = scenarios.map((scenario, index) => ({
    scene: scenario.scene,
    headline: scenario.title,
    body: 'Same DSL -> SVG + PNG + reusable video scenes.',
    accent: `Scenario ${String(index + 1).padStart(2, '0')}`,
    duration_seconds: index === 0 ? 4.5 : 3.75,
  }));
  return {
    title: 'Scenario suite',
    subtitle: 'One scene graph DSL can produce many types of scenes.',
    theme: 'slate',
    scenes,
    width: 1280,
    height: 720,
    fps: 24,
    output_name: 'scenario-suite-sequence',
  };
}

export async function generateScenarioSuite(projectRoot: string, options?: { outputRoot?: string; includeVideo?: boolean }): Promise<MediaPipelineRunResult> {
  const outputRoot = options?.outputRoot ?? path.join(projectRoot, 'outputs');
  const runId = makeRunId();
  const runDir = path.join(outputRoot, 'runs', runId);
  const suiteDir = path.join(runDir, '08_scenario-suite');
  const manifestPath = path.join(runDir, '00_manifest.md');
  const reportPath = path.join(runDir, '99_report.md');
  const indexPath = path.join(outputRoot, 'index.json');
  const galleryPath = path.join(outputRoot, 'gallery', 'index.html');

  await ensureDir(suiteDir);
  await ensureDir(path.dirname(galleryPath));

  const scenarios = scenarioList();
  const assets: MediaAssetRecord[] = [];
  const validations: ValidationRecord[] = [];

  for (const scenario of scenarios) {
    const out = await renderSvgScene({ scene: scenario.scene, output_name: scenario.id }, suiteDir);
    assets.push(assetRecord(scenario.id, 'scenario-suite', scenario.title, out.png_path ?? out.svg_path, [out.svg_path].filter((file) => file !== (out.png_path ?? out.svg_path)), out.width, out.height));
    validations.push(await validateFileExists(out.svg_path));
    if (out.png_path) validations.push(await validateFileExists(out.png_path));
  }

  if (options?.includeVideo !== false) {
    const video = await renderSvgSceneVideo(scenarioSequenceVideoInput(scenarios), suiteDir);
    assets.push({
      id: 'scenario-suite-sequence',
      category: 'scenario-suite',
      renderer: 'remotion_video',
      title: 'Scenario suite sequence video',
      status: 'generated',
      primary_path: video.file_path,
      width: video.width,
      height: video.height,
      notes: [`${video.duration_seconds}s at ${video.fps} fps`],
    });
    validations.push(await validateFileExists(video.file_path));
  }

  const manifestLines: string[] = [
    '# Media run manifest',
    '',
    `- Run timestamp: ${new Date().toISOString()}`,
    `- Run id: \`${runId}\``,
    '- Project: Claude MCP Media Runner',
    '',
    '## Generated assets',
    '',
    ...assets.map((asset) => `- ${asset.title} (${asset.renderer}) -> \`${path.relative(projectRoot, asset.primary_path)}\`${asset.secondary_paths?.length ? ` plus ${asset.secondary_paths.map((file) => `\`${path.relative(projectRoot, file)}\``).join(', ')}` : ''}`),
    '',
    '## Validation',
    '',
    ...validations.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'}: \`${path.relative(projectRoot, item.file)}\` - ${item.note}`),
    '',
    '## Next suggested test',
    '',
    '- Use `render_svg_scene` from MCP to generate a new scenario board, then add it into the suite.',
  ];
  await fs.writeFile(manifestPath, `${manifestLines.join('\n')}\n`, 'utf8');

  const reportLines: string[] = [
    '# Media pipeline report',
    '',
    '## Summary',
    '',
    'This run demonstrates a scenario suite: many different scene categories rendered from the same SVG scene graph DSL.',
    '',
    '## Scenarios included',
    '',
    ...scenarios.map((scenario) => `- ${scenario.title} -> \`08_scenario-suite/${scenario.id}.png\``),
    '',
    '## What looks good',
    '',
    '- Many scene categories share one renderer and consistent typography rules.',
    '- Vector primitives + filters/gradients avoid “toy SVG” vibes.',
    '- Outputs are deterministic and reviewable.',
    '',
    '## What is still limited',
    '',
    '- No full auto-layout engine (constraints/grid) yet; templates still matter.',
    '- No camera moves in scene-video; sequence is still board-driven.',
  ];
  await fs.writeFile(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  // Append to outputs index
  let existing: unknown[] = [];
  try {
    existing = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    if (!Array.isArray(existing)) existing = [];
  } catch {
    existing = [];
  }
  const entry = {
    run_id: runId,
    timestamp: new Date().toISOString(),
    run_dir: runDir,
    manifest_path: manifestPath,
    report_path: reportPath,
    assets_count: assets.length,
    video_count: assets.filter((asset) => asset.primary_path.endsWith('.mp4')).length,
    status: 'completed' as const,
    featured_assets: assets.slice(0, 4).map((asset) => ({
      title: asset.title,
      path: asset.primary_path,
      kind: asset.primary_path.endsWith('.mp4') ? 'video' : asset.primary_path.endsWith('.md') ? 'document' : 'image',
    })),
  };
  (existing as unknown[]).unshift(entry);
  await fs.writeFile(indexPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  await generateOutputGallery(projectRoot);

  return {
    run_id: runId,
    run_dir: runDir,
    manifest_path: manifestPath,
    report_path: reportPath,
    index_path: indexPath,
    gallery_path: galleryPath,
    assets,
    skipped: [],
  };
}
