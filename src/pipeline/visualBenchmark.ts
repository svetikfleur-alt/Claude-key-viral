import fs from 'node:fs/promises';
import path from 'node:path';

import { renderHtmlCard } from '../codegen/htmlCardRenderer.js';
import { renderSvgScene, renderSvgSceneVideo } from '../codegen/sceneDslRenderer.js';
import { renderRemotionVideo } from '../codegen/remotionRenderer.js';
import { generateOutputGallery } from './outputGallery.js';
import type {
  MediaAssetRecord,
  MediaPipelineRunResult,
  RemotionVideoInput,
  SvgSceneSpec,
  SvgSceneVideoInput,
} from '../types.js';

type BenchmarkRow = {
  use_case: string;
  file_path?: string;
  method: 'html_css_card' | 'svg_template' | 'scene_graph_svg' | 'scene_graph_png' | 'video_remotion' | 'video_scene_sequence' | 'skipped' | 'failed';
  quality: 'good' | 'acceptable' | 'weak' | 'failed';
  suitable_readme: boolean;
  suitable_social: boolean;
  technical_demo_only: boolean;
  needs_ai_background: boolean;
  needs_template_fix: boolean;
  notes: string;
};

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

function assetRecord(id: string, category: string, renderer: MediaAssetRecord['renderer'], title: string, primary: string, secondary: string[] | undefined, width: number, height: number, notes?: string[]): MediaAssetRecord {
  return {
    id,
    category,
    renderer,
    title,
    status: 'generated',
    primary_path: primary,
    secondary_paths: secondary,
    width,
    height,
    notes,
  };
}

async function readLocalPngAsDataUrl(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function baselineDefs() {
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
          { offset: '50%', color: '#07152a' },
          { offset: '100%', color: '#101c33' },
        ],
      },
      {
        id: 'orbA',
        type: 'radial' as const,
        cx: '42%',
        cy: '30%',
        r: '60%',
        stops: [
          { offset: '0%', color: '#7dd3fc', opacity: 0.26 },
          { offset: '65%', color: '#2563eb', opacity: 0.08 },
          { offset: '100%', color: '#0b1220', opacity: 0 },
        ],
      },
      {
        id: 'orbB',
        type: 'radial' as const,
        cx: '75%',
        cy: '65%',
        r: '66%',
        stops: [
          { offset: '0%', color: '#c4b5fd', opacity: 0.18 },
          { offset: '60%', color: '#7c3aed', opacity: 0.06 },
          { offset: '100%', color: '#0b1220', opacity: 0 },
        ],
      },
    ],
    filters: [
      { id: 'shadow', type: 'drop_shadow' as const, dx: 0, dy: 18, std_deviation: 24, color: '#020617', opacity: 0.55 },
      { id: 'glow', type: 'drop_shadow' as const, dx: 0, dy: 0, std_deviation: 14, color: '#38bdf8', opacity: 0.32 },
    ],
  };
}

function overlayHeader(title: string, subtitle: string, eyebrow: string, x: number, y: number, w: number) {
  return {
    kind: 'group' as const,
    x,
    y,
    children: [
      { kind: 'rect' as const, x: 0, y: 0, width: w, height: 230, radius: 28, fill: 'rgba(8, 16, 30, 0.72)', stroke: 'rgba(125, 211, 252, 0.18)', filter: 'shadow' },
      { kind: 'text' as const, x: 30, y: 46, width: w - 60, text: eyebrow, font_size: 18, font_weight: 750, letter_spacing: 2.2, fill: '#7dd3fc' },
      { kind: 'text' as const, x: 30, y: 96, width: w - 60, text: title, font_size: 58, font_weight: 820, fill: '#f8fafc', line_height: 1.03 },
      { kind: 'text' as const, x: 30, y: 176, width: w - 60, text: subtitle, font_size: 24, fill: '#c7d7ea', line_height: 1.35 },
    ],
  };
}

function quoteCardScene(): SvgSceneSpec {
  return {
    width: 1080,
    height: 1080,
    background: 'url(#bg)',
    defs: baselineDefs(),
    nodes: [
      { kind: 'circle', cx: 420, cy: 260, r: 420, fill: 'url(#orbA)', opacity: 0.9 },
      { kind: 'circle', cx: 820, cy: 820, r: 520, fill: 'url(#orbB)', opacity: 0.8 },
      { kind: 'rect', x: 60, y: 60, width: 960, height: 960, radius: 40, stroke: 'rgba(148,163,184,0.18)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 120, y: 180, width: 840, text: 'QUOTE CARD', font_size: 18, font_weight: 750, letter_spacing: 2.3, fill: '#93c5fd' },
      { kind: 'text', x: 120, y: 260, width: 840, text: '“Most AI media starts with randomness.\nThis pipeline starts with structure.”', font_size: 54, font_weight: 760, fill: '#f8fafc', line_height: 1.2 },
      { kind: 'rect', x: 120, y: 630, width: 240, height: 6, radius: 3, fill: 'rgba(125, 211, 252, 0.72)' },
      { kind: 'text', x: 120, y: 720, width: 840, text: 'Code-first templates • deterministic outputs • local-first execution', font_size: 26, fill: '#c7d7ea', line_height: 1.35 },
      { kind: 'text', x: 120, y: 900, width: 840, text: 'comfyui-mcp-runner', font_size: 18, font_weight: 650, letter_spacing: 1.1, fill: 'rgba(148, 163, 184, 0.9)' },
    ],
  };
}

function pipelineDiagramScene(): SvgSceneSpec {
  const defs = baselineDefs();
  const panelFill = 'rgba(8, 16, 30, 0.86)';
  const panelStroke = 'rgba(148, 163, 184, 0.18)';
  const accentA = '#fb923c';
  const accentB = '#a78bfa';
  const accentC = '#60a5fa';
  const accentD = '#34d399';

  const block = (x: number, y: number, w: number, h: number, title: string, subtitle: string, accent: string) => ({
    kind: 'group' as const,
    x,
    y,
    children: [
      { kind: 'rect' as const, x: 0, y: 0, width: w, height: h, radius: 28, fill: panelFill, stroke: `${accent}2b`, filter: 'shadow' },
      { kind: 'rect' as const, x: 24, y: 24, width: 44, height: 8, radius: 4, fill: accent },
      { kind: 'text' as const, x: 24, y: 70, width: w - 48, text: title, font_size: 30, font_weight: 820, fill: '#f8fafc', line_height: 1.08 },
      { kind: 'text' as const, x: 24, y: 118, width: w - 48, text: subtitle, font_size: 18, fill: '#bfd0e4', line_height: 1.45 },
    ],
  });

  const iconTile = (x: number, y: number, w: number, h: number, accent: string, label: string) => ({
    kind: 'group' as const,
    x,
    y,
    children: [
      { kind: 'rect' as const, x: 0, y: 0, width: w, height: h, radius: 22, fill: 'rgba(15, 23, 42, 0.86)', stroke: `${accent}22` },
      { kind: 'circle' as const, cx: 40, cy: 38, r: 14, fill: `${accent}55` },
      { kind: 'rect' as const, x: 70, y: 28, width: w - 94, height: 8, radius: 4, fill: 'rgba(226, 232, 240, 0.22)' },
      { kind: 'rect' as const, x: 70, y: 46, width: w - 140, height: 8, radius: 4, fill: 'rgba(226, 232, 240, 0.14)' },
      { kind: 'text' as const, x: 22, y: 74, width: w - 44, text: label, font_size: 16, font_weight: 650, fill: 'rgba(148, 163, 184, 0.95)' },
    ],
  });

  const arrow = (x1: number, y1: number, x2: number, y2: number, accent: string) => ({
    kind: 'path' as const,
    d: `M${x1} ${y1} C${x1 + 80} ${y1} ${x2 - 80} ${y2} ${x2} ${y2}`,
    stroke: `${accent}aa`,
    stroke_width: 4,
    stroke_linecap: 'round' as const,
    fill: 'none',
  });

  // Layout constants
  const W = 1600;
  const H = 900;
  const margin = 72;
  const headerH = 190;
  const blockY = margin + headerH;
  const blockW = 330;
  const blockH = 210;
  const gap = 70;
  const xA = margin;
  const xB = xA + blockW + gap;
  const xC = xB + blockW + gap;
  const xD = xC + blockW + gap;

  // Lower tray (structured outputs + manifest/logs/timeline vibe)
  const trayY = blockY + blockH + 50;
  const trayH = H - trayY - margin;

  return {
    width: W,
    height: H,
    background: 'url(#bg)',
    defs: {
      gradients: [
        ...(defs.gradients ?? []),
        {
          id: 'tray',
          type: 'linear' as const,
          x1: '0%',
          y1: '0%',
          x2: '100%',
          y2: '0%',
          stops: [
            { offset: '0%', color: '#07152a', opacity: 0.92 },
            { offset: '50%', color: '#0b1430', opacity: 0.92 },
            { offset: '100%', color: '#071b2a', opacity: 0.92 },
          ],
        },
      ],
      filters: defs.filters,
    },
    nodes: [
      { kind: 'circle', cx: 1220, cy: 180, r: 420, fill: 'url(#orbA)', opacity: 0.9 },
      { kind: 'circle', cx: 420, cy: 820, r: 620, fill: 'url(#orbB)', opacity: 0.72 },
      { kind: 'rect', x: 46, y: 46, width: 1508, height: 808, radius: 34, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },

      { kind: 'text', x: margin, y: 110, width: 920, text: 'Structured media pipeline', font_size: 64, font_weight: 860, fill: '#f8fafc', line_height: 1.0 },
      { kind: 'text', x: margin, y: 168, width: 980, text: 'Claude Desktop → Local MCP Runner → Code renderers / Optional local ComfyUI → Outputs', font_size: 24, fill: '#c7d7ea' },
      { kind: 'rect', x: margin, y: 190, width: 640, height: 6, radius: 3, fill: 'rgba(125,211,252,0.72)' },

      block(xA, blockY, blockW, blockH, 'Claude Desktop', 'Calls MCP tools with structured inputs.\nNo custom UI required.', accentA),
      block(xB, blockY, blockW, blockH, 'Local MCP Runner', 'Validates requests.\nChooses renderer.\nWrites manifests.', accentB),
      block(xC, blockY, blockW, blockH, 'Renderers', 'HTML/CSS cards • SVG diagrams\nVideo-as-code', accentC),
      block(xD, blockY, blockW, blockH, 'Outputs', 'Run folders • logs • index.json\nLocal gallery', accentD),

      arrow(xA + blockW, blockY + blockH / 2, xB, blockY + blockH / 2, '#fbbf24'),
      arrow(xB + blockW, blockY + blockH / 2, xC, blockY + blockH / 2, '#a78bfa'),
      arrow(xC + blockW, blockY + blockH / 2, xD, blockY + blockH / 2, '#60a5fa'),

      // Optional ComfyUI badge (explicitly optional)
      {
        kind: 'group' as const,
        x: xC + 20,
        y: blockY + 160,
        children: [
          { kind: 'rect' as const, x: 0, y: 0, width: 290, height: 48, radius: 18, fill: 'rgba(2, 6, 23, 0.55)', stroke: 'rgba(52, 211, 153, 0.26)' },
          { kind: 'text' as const, x: 18, y: 18, width: 260, text: 'Optional: local ComfyUI', font_size: 18, font_weight: 760, fill: '#34d399' },
        ],
      },

      // Tray
      { kind: 'rect', x: margin, y: trayY, width: W - margin * 2, height: trayH, radius: 34, fill: 'url(#tray)', stroke: panelStroke, filter: 'shadow' },
      { kind: 'text', x: margin + 28, y: trayY + 54, width: 860, text: 'Structured outputs (inspectable)', font_size: 26, font_weight: 820, fill: '#f8fafc' },
      { kind: 'text', x: margin + 28, y: trayY + 92, width: 940, text: 'Deterministic assets + manifests. Compare runs like builds.', font_size: 18, fill: '#bfd0e4' },

      // Mini grid of previews
      iconTile(margin + 28, trayY + 126, 320, 160, '#7dd3fc', 'hero-banner.png'),
      iconTile(margin + 370, trayY + 126, 320, 160, '#86efac', 'pipeline-diagram.svg'),
      iconTile(margin + 712, trayY + 126, 320, 160, '#facc15', 'social-card.png'),
      iconTile(margin + 1054, trayY + 126, 320, 160, '#c4b5fd', 'intro-sequence.mp4'),

      // Timeline-ish bands
      { kind: 'rect', x: margin + 28, y: trayY + 312, width: W - margin * 2 - 56, height: 10, radius: 5, fill: 'rgba(148,163,184,0.12)' },
      { kind: 'rect', x: margin + 28, y: trayY + 342, width: W - margin * 2 - 56, height: 10, radius: 5, fill: 'rgba(148,163,184,0.10)' },
      { kind: 'rect', x: margin + 28, y: trayY + 372, width: W - margin * 2 - 56, height: 10, radius: 5, fill: 'rgba(148,163,184,0.08)' },
      { kind: 'rect', x: margin + 28, y: trayY + 312, width: 460, height: 10, radius: 5, fill: 'rgba(125,211,252,0.38)' },
      { kind: 'rect', x: margin + 28, y: trayY + 342, width: 640, height: 10, radius: 5, fill: 'rgba(167,139,250,0.28)' },
      { kind: 'rect', x: margin + 28, y: trayY + 372, width: 880, height: 10, radius: 5, fill: 'rgba(52,211,153,0.22)' },

      { kind: 'text', x: margin + 28, y: trayY + trayH - 26, width: 1200, text: 'Local-first • no hosted server • structure before randomness', font_size: 18, fill: 'rgba(148, 163, 184, 0.9)' },
    ],
  };
}

function beforeAfterScene(): SvgSceneSpec {
  return {
    width: 1600,
    height: 900,
    background: '#050b16',
    defs: {
      gradients: [
        ...baselineDefs().gradients,
        {
          id: 'splitLeft',
          type: 'linear' as const,
          x1: '0%',
          y1: '0%',
          x2: '100%',
          y2: '0%',
          stops: [
            { offset: '0%', color: '#220810' },
            { offset: '100%', color: '#0b1220' },
          ],
        },
        {
          id: 'splitRight',
          type: 'linear' as const,
          x1: '0%',
          y1: '0%',
          x2: '100%',
          y2: '0%',
          stops: [
            { offset: '0%', color: '#071b2a' },
            { offset: '100%', color: '#031626' },
          ],
        },
      ],
      filters: baselineDefs().filters,
    },
    nodes: [
      { kind: 'rect', x: 0, y: 0, width: 800, height: 900, fill: 'url(#splitLeft)' },
      { kind: 'rect', x: 800, y: 0, width: 800, height: 900, fill: 'url(#splitRight)' },
      { kind: 'rect', x: 798, y: 0, width: 4, height: 900, fill: 'rgba(148,163,184,0.25)' },
      { kind: 'text', x: 100, y: 130, width: 600, text: 'Random', font_size: 72, font_weight: 860, fill: '#fb7185' },
      { kind: 'text', x: 900, y: 130, width: 600, text: 'Structured', font_size: 72, font_weight: 860, fill: '#34d399' },
      { kind: 'text', x: 100, y: 200, width: 620, text: 'One-off prompts.\nInconsistent outputs.\nNo manifests.', font_size: 28, fill: '#fecdd3', line_height: 1.45 },
      { kind: 'text', x: 900, y: 200, width: 620, text: 'Templates.\nStable inputs.\nOrganized run folders.', font_size: 28, fill: '#bbf7d0', line_height: 1.45 },
      { kind: 'rect', x: 100, y: 320, width: 600, height: 460, radius: 34, fill: 'rgba(3, 8, 22, 0.55)', stroke: 'rgba(244, 63, 94, 0.24)', filter: 'shadow' },
      { kind: 'rect', x: 900, y: 320, width: 600, height: 460, radius: 34, fill: 'rgba(3, 8, 22, 0.55)', stroke: 'rgba(52, 211, 153, 0.22)', filter: 'shadow' },
      { kind: 'text', x: 132, y: 372, width: 540, text: 'Scatter', font_size: 26, font_weight: 760, fill: '#fecdd3' },
      { kind: 'text', x: 932, y: 372, width: 540, text: 'Pipeline', font_size: 26, font_weight: 760, fill: '#bbf7d0' },
      // Left: chaotic dots
      ...Array.from({ length: 140 }).map((_, i) => {
        const x = 140 + (i * 37) % 520;
        const y = 410 + (i * 53) % 330;
        const r = 2 + (i % 5);
        const colors = ['rgba(251,113,133,0.55)', 'rgba(167,139,250,0.42)', 'rgba(125,211,252,0.32)', 'rgba(250,204,21,0.28)'];
        return { kind: 'circle' as const, cx: x, cy: y, r, fill: colors[i % colors.length] };
      }),
      // Right: tidy blocks + arrows
      { kind: 'rect', x: 940, y: 420, width: 220, height: 92, radius: 22, fill: 'rgba(8,16,30,0.92)', stroke: 'rgba(125,211,252,0.18)' },
      { kind: 'rect', x: 1200, y: 420, width: 220, height: 92, radius: 22, fill: 'rgba(8,16,30,0.92)', stroke: 'rgba(134,239,172,0.18)' },
      { kind: 'rect', x: 940, y: 550, width: 220, height: 92, radius: 22, fill: 'rgba(8,16,30,0.92)', stroke: 'rgba(250,204,21,0.18)' },
      { kind: 'rect', x: 1200, y: 550, width: 220, height: 92, radius: 22, fill: 'rgba(8,16,30,0.92)', stroke: 'rgba(196,181,253,0.18)' },
      { kind: 'text', x: 970, y: 476, width: 180, text: 'Brief', font_size: 24, font_weight: 760, fill: '#e2e8f0' },
      { kind: 'text', x: 1230, y: 476, width: 180, text: 'Plan', font_size: 24, font_weight: 760, fill: '#e2e8f0' },
      { kind: 'text', x: 970, y: 606, width: 180, text: 'Render', font_size: 24, font_weight: 760, fill: '#e2e8f0' },
      { kind: 'text', x: 1230, y: 606, width: 180, text: 'Index', font_size: 24, font_weight: 760, fill: '#e2e8f0' },
      { kind: 'path', d: 'M1166 466 C1180 466 1188 466 1200 466', stroke: 'rgba(148,163,184,0.55)', stroke_width: 3, stroke_linecap: 'round', fill: 'none' },
      { kind: 'path', d: 'M1166 596 C1180 596 1188 596 1200 596', stroke: 'rgba(148,163,184,0.55)', stroke_width: 3, stroke_linecap: 'round', fill: 'none' },
    ],
  };
}

function dashboardScene(): SvgSceneSpec {
  return {
    width: 1600,
    height: 900,
    background: 'url(#bg)',
    defs: baselineDefs(),
    nodes: [
      { kind: 'circle', cx: 1160, cy: 170, r: 360, fill: 'url(#orbA)', opacity: 0.85 },
      { kind: 'circle', cx: 1320, cy: 820, r: 520, fill: 'url(#orbB)', opacity: 0.65 },
      { kind: 'rect', x: 54, y: 54, width: 1492, height: 792, radius: 34, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },
      overlayHeader('Media Workbench Mockup', 'Brief → Plan → Render → Validate → Index → Report', 'DASHBOARD / WORKBENCH', 96, 90, 720),
      // Left panel: brief
      { kind: 'rect', x: 96, y: 360, width: 430, height: 458, radius: 26, fill: 'rgba(8, 16, 30, 0.9)', stroke: 'rgba(125,211,252,0.16)', filter: 'shadow' },
      { kind: 'text', x: 130, y: 414, width: 360, text: 'Media brief', font_size: 28, font_weight: 780, fill: '#f8fafc' },
      { kind: 'text', x: 130, y: 462, width: 380, text: 'Generate a README hero + diagram + social card.\nNo hosted services. Reproducible outputs.', font_size: 18, fill: '#bfd0e4', line_height: 1.5 },
      // Center: renderer selector
      { kind: 'rect', x: 560, y: 360, width: 470, height: 458, radius: 26, fill: 'rgba(8, 16, 30, 0.9)', stroke: 'rgba(134,239,172,0.16)', filter: 'shadow' },
      { kind: 'text', x: 594, y: 414, width: 410, text: 'Renderer', font_size: 28, font_weight: 780, fill: '#f8fafc' },
      { kind: 'rect', x: 594, y: 456, width: 410, height: 74, radius: 20, fill: 'rgba(15,23,42,0.92)', stroke: 'rgba(125,211,252,0.16)' },
      { kind: 'text', x: 620, y: 484, width: 360, text: 'HTML/CSS cards', font_size: 22, font_weight: 700, fill: '#7dd3fc' },
      { kind: 'rect', x: 594, y: 546, width: 410, height: 74, radius: 20, fill: 'rgba(15,23,42,0.92)', stroke: 'rgba(134,239,172,0.16)' },
      { kind: 'text', x: 620, y: 574, width: 360, text: 'SVG diagrams', font_size: 22, font_weight: 700, fill: '#86efac' },
      { kind: 'rect', x: 594, y: 636, width: 410, height: 74, radius: 20, fill: 'rgba(15,23,42,0.92)', stroke: 'rgba(196,181,253,0.16)' },
      { kind: 'text', x: 620, y: 664, width: 360, text: 'Video-as-code', font_size: 22, font_weight: 700, fill: '#c4b5fd' },
      { kind: 'text', x: 594, y: 748, width: 410, text: 'Optional: local ComfyUI for richness\n(kept separate from layout).', font_size: 18, fill: '#bfd0e4', line_height: 1.5 },
      // Right: output preview + manifest
      { kind: 'rect', x: 1060, y: 360, width: 486, height: 458, radius: 26, fill: 'rgba(8, 16, 30, 0.9)', stroke: 'rgba(250,204,21,0.16)', filter: 'shadow' },
      { kind: 'text', x: 1094, y: 414, width: 420, text: 'Outputs', font_size: 28, font_weight: 780, fill: '#f8fafc' },
      { kind: 'rect', x: 1094, y: 456, width: 420, height: 222, radius: 22, fill: 'rgba(15,23,42,0.92)', stroke: 'rgba(148,163,184,0.16)' },
      { kind: 'rect', x: 1120, y: 482, width: 160, height: 86, radius: 18, fill: 'rgba(2,6,23,0.55)', stroke: 'rgba(125,211,252,0.2)' },
      { kind: 'rect', x: 1300, y: 482, width: 188, height: 86, radius: 18, fill: 'rgba(2,6,23,0.55)', stroke: 'rgba(134,239,172,0.2)' },
      { kind: 'rect', x: 1120, y: 580, width: 160, height: 86, radius: 18, fill: 'rgba(2,6,23,0.55)', stroke: 'rgba(250,204,21,0.2)' },
      { kind: 'rect', x: 1300, y: 580, width: 188, height: 86, radius: 18, fill: 'rgba(2,6,23,0.55)', stroke: 'rgba(196,181,253,0.2)' },
      { kind: 'text', x: 1094, y: 714, width: 420, text: 'manifest.md • report.md • outputs/index.json', font_size: 18, fill: '#c7d7ea', line_height: 1.45 },
      { kind: 'text', x: 1094, y: 756, width: 420, text: 'Everything visible, organized, inspectable.', font_size: 20, font_weight: 700, fill: '#f8fafc' },
    ],
  };
}

function abstractBackgroundScene(): SvgSceneSpec {
  return {
    width: 1600,
    height: 900,
    background: 'url(#bg)',
    defs: {
      gradients: [
        {
          id: 'bg',
          type: 'linear' as const,
          x1: '0%',
          y1: '0%',
          x2: '100%',
          y2: '100%',
          stops: [
            { offset: '0%', color: '#020617' },
            { offset: '45%', color: '#0b1b34' },
            { offset: '100%', color: '#12063a' },
          ],
        },
        {
          id: 'flare',
          type: 'radial' as const,
          cx: '72%',
          cy: '40%',
          r: '70%',
          stops: [
            { offset: '0%', color: '#38bdf8', opacity: 0.16 },
            { offset: '50%', color: '#a78bfa', opacity: 0.09 },
            { offset: '100%', color: '#020617', opacity: 0 },
          ],
        },
        {
          id: 'rim',
          type: 'linear' as const,
          x1: '0%',
          y1: '100%',
          x2: '100%',
          y2: '0%',
          stops: [
            { offset: '0%', color: '#60a5fa', opacity: 0.0 },
            { offset: '40%', color: '#60a5fa', opacity: 0.16 },
            { offset: '100%', color: '#c4b5fd', opacity: 0.0 },
          ],
        },
      ],
      filters: baselineDefs().filters,
    },
    nodes: [
      { kind: 'circle', cx: 1200, cy: 240, r: 560, fill: 'url(#flare)', opacity: 0.95 },
      { kind: 'path', d: 'M-40 780 C320 620 560 760 840 612 C1108 470 1258 520 1680 340', stroke: 'rgba(125,211,252,0.24)', stroke_width: 3, stroke_linecap: 'round', fill: 'none' },
      { kind: 'path', d: 'M-40 840 C320 720 560 820 860 690 C1120 582 1330 630 1700 486', stroke: 'rgba(196,181,253,0.16)', stroke_width: 2, stroke_linecap: 'round', fill: 'none' },
      { kind: 'rect', x: 54, y: 54, width: 1492, height: 792, radius: 34, stroke: 'rgba(148,163,184,0.14)', fill: 'rgba(0,0,0,0)' },
      { kind: 'rect', x: 90, y: 90, width: 1420, height: 720, radius: 40, fill: 'rgba(2,6,23,0.26)', stroke: 'rgba(148,163,184,0.12)' },
      { kind: 'rect', x: 90, y: 744, width: 1420, height: 2, fill: 'url(#rim)' },
      { kind: 'text', x: 130, y: 160, width: 900, text: 'Abstract cinematic background', font_size: 56, font_weight: 820, fill: '#f8fafc', line_height: 1.04 },
      { kind: 'text', x: 130, y: 244, width: 900, text: 'Pure code can do atmosphere for overlays, but not photoreal scenes.', font_size: 24, fill: '#c7d7ea', line_height: 1.35 },
      { kind: 'text', x: 130, y: 820, width: 900, text: 'Use as a stable background layer under structured typography.', font_size: 18, fill: 'rgba(148,163,184,0.9)' },
    ],
  };
}

function videoIntroFrameScene(): SvgSceneSpec {
  return {
    width: 1920,
    height: 1080,
    background: 'url(#bg)',
    defs: baselineDefs(),
    nodes: [
      { kind: 'circle', cx: 1320, cy: 220, r: 560, fill: 'url(#orbA)', opacity: 0.8 },
      { kind: 'circle', cx: 380, cy: 920, r: 720, fill: 'url(#orbB)', opacity: 0.65 },
      { kind: 'rect', x: 80, y: 80, width: 1760, height: 920, radius: 46, stroke: 'rgba(125,211,252,0.14)', fill: 'rgba(0,0,0,0)' },
      { kind: 'text', x: 150, y: 200, width: 1320, text: 'Claude MCP Media Runner', font_size: 92, font_weight: 880, fill: '#f8fafc', line_height: 1.02 },
      { kind: 'text', x: 150, y: 320, width: 1120, text: 'Local-first structured media workflows', font_size: 42, font_weight: 740, fill: '#c7d7ea' },
      { kind: 'rect', x: 150, y: 390, width: 520, height: 8, radius: 4, fill: 'rgba(125,211,252,0.8)' },
      { kind: 'text', x: 150, y: 470, width: 1000, text: 'Structure before randomness.', font_size: 36, font_weight: 780, fill: '#7dd3fc' },
      { kind: 'rect', x: 150, y: 560, width: 1620, height: 250, radius: 38, fill: 'rgba(8,16,30,0.72)', stroke: 'rgba(148,163,184,0.16)', filter: 'shadow' },
      { kind: 'text', x: 190, y: 640, width: 540, text: 'Claude Desktop', font_size: 28, font_weight: 780, fill: '#f8fafc' },
      { kind: 'text', x: 700, y: 640, width: 540, text: 'Local MCP Runner', font_size: 28, font_weight: 780, fill: '#f8fafc' },
      { kind: 'text', x: 1240, y: 640, width: 540, text: 'Outputs', font_size: 28, font_weight: 780, fill: '#f8fafc' },
      { kind: 'path', d: 'M560 650 C610 650 650 650 690 650', stroke: 'rgba(125,211,252,0.7)', stroke_width: 4, stroke_linecap: 'round', fill: 'none' },
      { kind: 'path', d: 'M1080 650 C1130 650 1170 650 1210 650', stroke: 'rgba(125,211,252,0.7)', stroke_width: 4, stroke_linecap: 'round', fill: 'none' },
      { kind: 'text', x: 190, y: 700, width: 440, text: 'Structured requests', font_size: 20, fill: '#bfd0e4' },
      { kind: 'text', x: 700, y: 700, width: 480, text: 'Renderers + optional local ComfyUI', font_size: 20, fill: '#bfd0e4' },
      { kind: 'text', x: 1240, y: 700, width: 480, text: 'Run folders, manifests, gallery', font_size: 20, fill: '#bfd0e4' },
    ],
  };
}

function pickLocalReferenceFrame(projectRoot: string): string | undefined {
  const candidates = [
    path.join(projectRoot, 'outputs', 'reference-studies'),
  ];
  return candidates.map((base) => base).find(() => true) ? undefined : undefined;
}

async function findAnyReferenceFramePng(projectRoot: string): Promise<string | undefined> {
  const root = path.join(projectRoot, 'outputs', 'reference-studies');
  try {
    const studies = await fs.readdir(root, { withFileTypes: true });
    for (const study of studies) {
      if (!study.isDirectory()) continue;
      const framesDir = path.join(root, study.name, '01_frames');
      try {
        const frames = (await fs.readdir(framesDir)).filter((name) => name.toLowerCase().endsWith('.png'));
        if (frames.length) return path.join(framesDir, frames.sort()[0]);
      } catch {
        // keep looking
      }
    }
  } catch {
    // no reference studies
  }
  return undefined;
}

function overlayOnPhotoScene(title: string, subtitle: string, eyebrow: string, photoDataUrl: string, width: number, height: number): SvgSceneSpec {
  return {
    width,
    height,
    background: '#050b16',
    defs: {
      ...baselineDefs(),
      gradients: [
        ...(baselineDefs().gradients ?? []),
        {
          id: 'shade',
          type: 'linear' as const,
          x1: '0%',
          y1: '0%',
          x2: '0%',
          y2: '100%',
          stops: [
            { offset: '0%', color: '#020617', opacity: 0.2 },
            { offset: '55%', color: '#020617', opacity: 0.45 },
            { offset: '100%', color: '#020617', opacity: 0.78 },
          ],
        },
      ],
    },
    nodes: [
      { kind: 'image', x: 0, y: 0, width, height, href: photoDataUrl, preserve_aspect: 'cover' },
      { kind: 'rect', x: 0, y: 0, width, height, fill: 'url(#shade)' },
      overlayHeader(title, subtitle, eyebrow, 72, 72, Math.min(860, width - 144)),
      { kind: 'text', x: 72, y: height - 90, width: width - 144, text: 'Hybrid note: background is a local reference frame. Swap later for local ComfyUI or stock.', font_size: 18, fill: 'rgba(148,163,184,0.9)' },
    ],
  };
}

function markdownTable(rows: BenchmarkRow[], projectRoot: string): string[] {
  const header = [
    '| Use case | Output | Method | Quality | README | Social | Tech demo | Needs AI bg | Needs fix | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  const lines = rows.map((row) => {
    const rel = row.file_path ? `\`${path.relative(projectRoot, row.file_path).replace(/\\/g, '/')}\`` : '`(none)`';
    return `| ${row.use_case} | ${rel} | ${row.method} | ${row.quality} | ${row.suitable_readme ? 'yes' : 'no'} | ${row.suitable_social ? 'yes' : 'no'} | ${row.technical_demo_only ? 'yes' : 'no'} | ${row.needs_ai_background ? 'yes' : 'no'} | ${row.needs_template_fix ? 'yes' : 'no'} | ${row.notes.replace(/\|/g, '\\|')} |`;
  });
  return [...header, ...lines];
}

function contactSheetSvg(tiles: Array<{ title: string; href: string; x: number; y: number; w: number; h: number }>, width: number, height: number): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const nodes = tiles.map((tile) => {
    return [
      `<rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" rx="22" ry="22" fill="rgba(8,16,30,0.72)" stroke="rgba(148,163,184,0.18)"/>`,
      `<image href="${esc(tile.href)}" x="${tile.x + 16}" y="${tile.y + 52}" width="${tile.w - 32}" height="${tile.h - 68}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip${tile.x}_${tile.y})"/>`,
      `<clipPath id="clip${tile.x}_${tile.y}"><rect x="${tile.x + 16}" y="${tile.y + 52}" width="${tile.w - 32}" height="${tile.h - 68}" rx="18" ry="18"/></clipPath>`,
      `<text x="${tile.x + 18}" y="${tile.y + 34}" fill="#e2e8f0" font-size="18" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${esc(tile.title)}</text>`,
    ].join('');
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#050b16"/><stop offset="55%" stop-color="#07152a"/><stop offset="100%" stop-color="#101c33"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/>${nodes}</svg>`;
}

export async function generateVisualBenchmark(projectRoot: string, options?: { outputRoot?: string; includeVideo?: boolean }): Promise<MediaPipelineRunResult> {
  const outputRoot = path.resolve(options?.outputRoot ?? path.join(projectRoot, 'outputs'));
  const runId = makeRunId();
  const runDir = path.join(outputRoot, 'runs', runId);
  const benchDir = path.join(runDir, 'visual-benchmark');

  const dirs = {
    hero: path.join(benchDir, '01-project-hero'),
    diagram: path.join(benchDir, '02-pipeline-diagram'),
    nature: path.join(benchDir, '03-nature-overlay'),
    travel: path.join(benchDir, '04-travel-promo'),
    quote: path.join(benchDir, '05-quote-card'),
    beforeAfter: path.join(benchDir, '06-before-after'),
    dashboard: path.join(benchDir, '07-dashboard'),
    abstract: path.join(benchDir, '08-abstract-background'),
    introFrame: path.join(benchDir, '09-video-intro-frame'),
    video: path.join(benchDir, '10-video-sequence'),
  };

  await Promise.all(Object.values(dirs).map(ensureDir));
  await ensureDir(path.join(outputRoot, 'gallery'));

  const validations: ValidationRecord[] = [];
  const assets: MediaAssetRecord[] = [];
  const rows: BenchmarkRow[] = [];

  // 1) Developer project hero card
  try {
    const hero = await renderHtmlCard({
      template: 'project_hero_banner',
      title: 'Claude MCP Media Runner',
      subtitle: 'Local-first structured media workflows for Claude, ComfyUI, and code-rendered assets.',
      eyebrow: 'Code-first media pipeline',
      bullets: [
        'Generate deterministic cards, diagrams, and videos from code.',
        'Keep outputs organized: run folders, manifests, and a local gallery.',
        'Use local ComfyUI only when you need realism or cinematic richness.',
      ],
      badges: ['Local-first', 'No API key required', 'Reproducible'],
      footer: 'Structure before randomness.',
      output_name: 'project-hero',
    }, dirs.hero);
    validations.push(await validateFileNonEmpty(hero.png_path));
    validations.push(await validateFileNonEmpty(hero.svg_path));
    assets.push(assetRecord('project-hero', 'visual-benchmark', 'html_card', 'Developer project hero card', hero.png_path, [hero.svg_path], hero.width, hero.height));
    rows.push({
      use_case: '1. Developer project hero card',
      file_path: hero.png_path,
      method: 'html_css_card',
      quality: 'good',
      suitable_readme: true,
      suitable_social: true,
      technical_demo_only: false,
      needs_ai_background: false,
      needs_template_fix: false,
      notes: 'Strong fit for code-first: hierarchy, spacing, deterministic.',
    });
  } catch (error: unknown) {
    rows.push({
      use_case: '1. Developer project hero card',
      method: 'failed',
      quality: 'failed',
      suitable_readme: false,
      suitable_social: false,
      technical_demo_only: true,
      needs_ai_background: false,
      needs_template_fix: true,
      notes: `Failed: ${(error as Error).message}`,
    });
  }

  // 2) Pipeline architecture diagram
  try {
    const diag = await renderSvgScene({
      scene: pipelineDiagramScene(),
      output_name: 'pipeline-architecture',
    }, dirs.diagram);
    const primary = diag.png_path ?? diag.svg_path;
    validations.push(await validateFileNonEmpty(primary));
    validations.push(await validateFileNonEmpty(diag.svg_path));
    assets.push(assetRecord('pipeline-diagram', 'visual-benchmark', 'scene_graph', 'Pipeline architecture diagram', primary, [diag.svg_path].filter((p) => p !== primary), diag.width, diag.height));
    rows.push({
      use_case: '2. Pipeline architecture diagram',
      file_path: primary,
      method: diag.png_path ? 'scene_graph_png' : 'scene_graph_svg',
      quality: 'good',
      suitable_readme: true,
      suitable_social: false,
      technical_demo_only: false,
      needs_ai_background: false,
      needs_template_fix: false,
      notes: 'Upgraded scene-graph diagram: clearer hierarchy, blocks, and structured outputs tray.',
    });
  } catch (error: unknown) {
    rows.push({
      use_case: '2. Pipeline architecture diagram',
      method: 'failed',
      quality: 'failed',
      suitable_readme: false,
      suitable_social: false,
      technical_demo_only: true,
      needs_ai_background: false,
      needs_template_fix: true,
      notes: `Failed: ${(error as Error).message}`,
    });
  }

  // 3) Nature cinematic background with overlay (HYBRID with local reference frame if available)
  try {
    const refFrame = await findAnyReferenceFramePng(projectRoot);
    if (!refFrame) {
      // Pure code fallback (expected weaker background)
      const pure = await renderSvgScene({
        output_name: 'nature-overlay-pure-code',
        scene: abstractBackgroundScene(),
      }, dirs.nature);
      validations.push(await validateFileNonEmpty(pure.png_path ?? pure.svg_path));
      assets.push(assetRecord('nature-overlay', 'visual-benchmark', 'scene_graph', 'Nature overlay (pure code fallback)', pure.png_path ?? pure.svg_path, [pure.svg_path], pure.width, pure.height));
      rows.push({
        use_case: '3. Nature cinematic background with overlay',
        file_path: pure.png_path ?? pure.svg_path,
        method: pure.png_path ? 'scene_graph_png' : 'scene_graph_svg',
        quality: 'weak',
        suitable_readme: false,
        suitable_social: false,
        technical_demo_only: true,
        needs_ai_background: true,
        needs_template_fix: false,
        notes: 'No local photo/reference found; pure code atmosphere works for overlays but not “cinematic nature”.',
      });
    } else {
      const photo = await readLocalPngAsDataUrl(refFrame);
      const natureScene = overlayOnPhotoScene(
        'Calm nature background',
        'Hybrid composition: local background + deterministic overlay zones.',
        'NATURE OVERLAY',
        photo,
        1600,
        900,
      );
      const out = await renderSvgScene({ scene: natureScene, output_name: 'nature-overlay' }, dirs.nature);
      validations.push(await validateFileNonEmpty(out.png_path ?? out.svg_path));
      assets.push(assetRecord('nature-overlay', 'visual-benchmark', 'scene_graph', 'Nature cinematic background + overlay (hybrid)', out.png_path ?? out.svg_path, [out.svg_path], out.width, out.height, [`background: ${refFrame}`]));
      rows.push({
        use_case: '3. Nature cinematic background with overlay',
        file_path: out.png_path ?? out.svg_path,
        method: out.png_path ? 'scene_graph_png' : 'scene_graph_svg',
        quality: 'acceptable',
        suitable_readme: false,
        suitable_social: true,
        technical_demo_only: false,
        needs_ai_background: true,
        needs_template_fix: false,
        notes: 'Hybrid is the correct method for scenic realism; overlay remains deterministic.',
      });
    }
  } catch (error: unknown) {
    rows.push({
      use_case: '3. Nature cinematic background with overlay',
      method: 'failed',
      quality: 'failed',
      suitable_readme: false,
      suitable_social: false,
      technical_demo_only: true,
      needs_ai_background: true,
      needs_template_fix: true,
      notes: `Failed: ${(error as Error).message}`,
    });
  }

  // 4) Travel / location promo card (hybrid if possible)
  try {
    const refFrame = await findAnyReferenceFramePng(projectRoot);
    if (!refFrame) {
      const out = await renderHtmlCard({
        template: 'use_case_card',
        title: 'Travel promo card',
        subtitle: 'Overlay-first: swap in a scenic photo later without breaking layout.',
        eyebrow: 'TRAVEL / LOCATION',
        bullets: ['Stable title zone', 'Safe margins', 'Deterministic typography'],
        badges: ['Hybrid-ready', 'Code-first overlay', 'Local-first'],
        footer: 'Background currently procedural.',
        output_name: 'travel-promo',
      }, dirs.travel);
      validations.push(await validateFileNonEmpty(out.png_path));
      assets.push(assetRecord('travel-promo', 'visual-benchmark', 'html_card', 'Travel / location promo card (overlay-first)', out.png_path, [out.svg_path], out.width, out.height));
      rows.push({
        use_case: '4. Travel / location promo card',
        file_path: out.png_path,
        method: 'html_css_card',
        quality: 'acceptable',
        suitable_readme: false,
        suitable_social: true,
        technical_demo_only: false,
        needs_ai_background: true,
        needs_template_fix: false,
        notes: 'Good overlay. Scenic realism should be a swapped background (photo or local ComfyUI).',
      });
    } else {
      const photo = await readLocalPngAsDataUrl(refFrame);
      const travelScene = overlayOnPhotoScene(
        'Ljubljana, dawn light',
        'Travel card: readable type over scenic visuals with safe zones.',
        'TRAVEL PROMO',
        photo,
        1600,
        900,
      );
      const out = await renderSvgScene({ scene: travelScene, output_name: 'travel-promo' }, dirs.travel);
      validations.push(await validateFileNonEmpty(out.png_path ?? out.svg_path));
      assets.push(assetRecord('travel-promo', 'visual-benchmark', 'scene_graph', 'Travel / location promo card (hybrid)', out.png_path ?? out.svg_path, [out.svg_path], out.width, out.height, [`background: ${refFrame}`]));
      rows.push({
        use_case: '4. Travel / location promo card',
        file_path: out.png_path ?? out.svg_path,
        method: out.png_path ? 'scene_graph_png' : 'scene_graph_svg',
        quality: 'acceptable',
        suitable_readme: false,
        suitable_social: true,
        technical_demo_only: false,
        needs_ai_background: true,
        needs_template_fix: false,
        notes: 'Hybrid composition works; overlay is deterministic and safe.',
      });
    }
  } catch (error: unknown) {
    rows.push({
      use_case: '4. Travel / location promo card',
      method: 'failed',
      quality: 'failed',
      suitable_readme: false,
      suitable_social: false,
      technical_demo_only: true,
      needs_ai_background: true,
      needs_template_fix: true,
      notes: `Failed: ${(error as Error).message}`,
    });
  }

  // 5) Social quote card (typographic)
  try {
    const out = await renderSvgScene({ scene: quoteCardScene(), output_name: 'quote-card' }, dirs.quote);
    validations.push(await validateFileNonEmpty(out.png_path ?? out.svg_path));
    assets.push(assetRecord('quote-card', 'visual-benchmark', 'scene_graph', 'Social quote card', out.png_path ?? out.svg_path, [out.svg_path], out.width, out.height));
    rows.push({
      use_case: '5. Social quote card',
      file_path: out.png_path ?? out.svg_path,
      method: out.png_path ? 'scene_graph_png' : 'scene_graph_svg',
      quality: 'good',
      suitable_readme: false,
      suitable_social: true,
      technical_demo_only: false,
      needs_ai_background: false,
      needs_template_fix: false,
      notes: 'Strong code-first class: typography + spacing + deterministic.',
    });
  } catch (error: unknown) {
    rows.push({
      use_case: '5. Social quote card',
      method: 'failed',
      quality: 'failed',
      suitable_readme: false,
      suitable_social: false,
      technical_demo_only: true,
      needs_ai_background: false,
      needs_template_fix: true,
      notes: `Failed: ${(error as Error).message}`,
    });
  }

  // 6) Before / after comparison card
  try {
    const out = await renderSvgScene({ scene: beforeAfterScene(), output_name: 'before-after' }, dirs.beforeAfter);
    validations.push(await validateFileNonEmpty(out.png_path ?? out.svg_path));
    assets.push(assetRecord('before-after', 'visual-benchmark', 'scene_graph', 'Before/after comparison card', out.png_path ?? out.svg_path, [out.svg_path], out.width, out.height));
    rows.push({
      use_case: '6. Before / after comparison card',
      file_path: out.png_path ?? out.svg_path,
      method: out.png_path ? 'scene_graph_png' : 'scene_graph_svg',
      quality: 'good',
      suitable_readme: true,
      suitable_social: true,
      technical_demo_only: false,
      needs_ai_background: false,
      needs_template_fix: false,
      notes: 'Strong storytelling structure; purely code.',
    });
  } catch (error: unknown) {
    rows.push({
      use_case: '6. Before / after comparison card',
      method: 'failed',
      quality: 'failed',
      suitable_readme: false,
      suitable_social: false,
      technical_demo_only: true,
      needs_ai_background: false,
      needs_template_fix: true,
      notes: `Failed: ${(error as Error).message}`,
    });
  }

  // 7) Dashboard / media workbench mockup
  try {
    const out = await renderSvgScene({ scene: dashboardScene(), output_name: 'dashboard-mockup' }, dirs.dashboard);
    validations.push(await validateFileNonEmpty(out.png_path ?? out.svg_path));
    assets.push(assetRecord('dashboard', 'visual-benchmark', 'scene_graph', 'Dashboard / media workbench mockup', out.png_path ?? out.svg_path, [out.svg_path], out.width, out.height));
    rows.push({
      use_case: '7. Dashboard / media workbench mockup',
      file_path: out.png_path ?? out.svg_path,
      method: out.png_path ? 'scene_graph_png' : 'scene_graph_svg',
      quality: 'acceptable',
      suitable_readme: false,
      suitable_social: true,
      technical_demo_only: false,
      needs_ai_background: false,
      needs_template_fix: false,
      notes: 'Good for explaining workflow UI; still schematic (not a real app screenshot).',
    });
  } catch (error: unknown) {
    rows.push({
      use_case: '7. Dashboard / media workbench mockup',
      method: 'failed',
      quality: 'failed',
      suitable_readme: false,
      suitable_social: false,
      technical_demo_only: true,
      needs_ai_background: false,
      needs_template_fix: true,
      notes: `Failed: ${(error as Error).message}`,
    });
  }

  // 8) Abstract cinematic background (pure code)
  try {
    const out = await renderSvgScene({ scene: abstractBackgroundScene(), output_name: 'abstract-background' }, dirs.abstract);
    validations.push(await validateFileNonEmpty(out.png_path ?? out.svg_path));
    assets.push(assetRecord('abstract-background', 'visual-benchmark', 'scene_graph', 'Abstract cinematic background', out.png_path ?? out.svg_path, [out.svg_path], out.width, out.height));
    rows.push({
      use_case: '8. Abstract cinematic background',
      file_path: out.png_path ?? out.svg_path,
      method: out.png_path ? 'scene_graph_png' : 'scene_graph_svg',
      quality: 'acceptable',
      suitable_readme: false,
      suitable_social: true,
      technical_demo_only: false,
      needs_ai_background: false,
      needs_template_fix: false,
      notes: 'Pure code atmosphere works well for overlays; not a substitute for photoreal shots.',
    });
  } catch (error: unknown) {
    rows.push({
      use_case: '8. Abstract cinematic background',
      method: 'failed',
      quality: 'failed',
      suitable_readme: false,
      suitable_social: false,
      technical_demo_only: true,
      needs_ai_background: false,
      needs_template_fix: true,
      notes: `Failed: ${(error as Error).message}`,
    });
  }

  // 9) Video intro frame (static)
  try {
    const out = await renderSvgScene({ scene: videoIntroFrameScene(), output_name: 'video-intro-frame' }, dirs.introFrame);
    validations.push(await validateFileNonEmpty(out.png_path ?? out.svg_path));
    assets.push(assetRecord('video-intro-frame', 'visual-benchmark', 'scene_graph', 'Video intro frame (still)', out.png_path ?? out.svg_path, [out.svg_path], out.width, out.height));
    rows.push({
      use_case: '9. Video intro frame',
      file_path: out.png_path ?? out.svg_path,
      method: out.png_path ? 'scene_graph_png' : 'scene_graph_svg',
      quality: 'good',
      suitable_readme: false,
      suitable_social: true,
      technical_demo_only: false,
      needs_ai_background: false,
      needs_template_fix: false,
      notes: 'Ready to animate; composition is motion-friendly.',
    });
  } catch (error: unknown) {
    rows.push({
      use_case: '9. Video intro frame',
      method: 'failed',
      quality: 'failed',
      suitable_readme: false,
      suitable_social: false,
      technical_demo_only: true,
      needs_ai_background: false,
      needs_template_fix: true,
      notes: `Failed: ${(error as Error).message}`,
    });
  }

  // 10) Short dynamic video sequence (if video pipeline works)
  const includeVideo = options?.includeVideo !== false;
  if (!includeVideo) {
    rows.push({
      use_case: '10. Short dynamic video sequence (10–20s)',
      method: 'skipped',
      quality: 'failed',
      suitable_readme: false,
      suitable_social: false,
      technical_demo_only: true,
      needs_ai_background: false,
      needs_template_fix: false,
      notes: 'Skipped by option.',
    });
  } else {
    try {
      const videoInput: RemotionVideoInput = {
        title: 'Claude MCP Media Runner',
        subtitle: 'Structure before randomness.',
        theme: 'slate',
        visual_style: 'presentation',
        duration_seconds: 12,
        width: 1280,
        height: 720,
        fps: 30,
        output_name: 'intro-sequence',
        scenes: [
          { headline: 'Local-first', body: 'Everything runs on your machine.\nNo hosted service required.', accent: '01' },
          { headline: 'Code-first', body: 'HTML/CSS cards • SVG diagrams • video-as-code\nDeterministic and reviewable.', accent: '02' },
          { headline: 'Optional ComfyUI', body: 'Use local ComfyUI when you need realism.\nKeep layout stable with overlays.', accent: '03' },
          { headline: 'Run folders', body: 'Outputs, manifests, logs, and a gallery index.\nEasy to compare runs.', accent: '04' },
        ],
      };
      const video = await renderRemotionVideo(videoInput, dirs.video);
      validations.push(await validateFileNonEmpty(video.file_path));
      assets.push(assetRecord('intro-video', 'visual-benchmark', 'remotion_video', 'Short intro video sequence', video.file_path, undefined, video.width, video.height, [`${video.duration_seconds}s @ ${video.fps} fps`]));
      rows.push({
        use_case: '10. Short dynamic video sequence (10–20s)',
        file_path: video.file_path,
        method: 'video_remotion',
        quality: 'acceptable',
        suitable_readme: false,
        suitable_social: true,
        technical_demo_only: false,
        needs_ai_background: false,
        needs_template_fix: false,
        notes: 'Video-as-code works if Remotion can render on this machine; content is structured and extendable.',
      });
    } catch (error: unknown) {
      rows.push({
        use_case: '10. Short dynamic video sequence (10–20s)',
        method: 'failed',
        quality: 'failed',
        suitable_readme: false,
        suitable_social: false,
        technical_demo_only: true,
        needs_ai_background: false,
        needs_template_fix: true,
        notes: `Failed: ${(error as Error).message}`,
      });
    }
  }

  // Contact sheet (SVG referencing generated PNGs where possible)
  const contactSheetPath = path.join(benchDir, 'CONTACT_SHEET.svg');
  try {
    const thumbs: Array<{ title: string; file?: string }> = [
      { title: 'Hero', file: assets.find((a) => a.id === 'project-hero')?.primary_path },
      { title: 'Diagram', file: assets.find((a) => a.id === 'pipeline-diagram')?.primary_path },
      { title: 'Nature', file: assets.find((a) => a.id === 'nature-overlay')?.primary_path },
      { title: 'Travel', file: assets.find((a) => a.id === 'travel-promo')?.primary_path },
      { title: 'Quote', file: assets.find((a) => a.id === 'quote-card')?.primary_path },
      { title: 'Before/After', file: assets.find((a) => a.id === 'before-after')?.primary_path },
      { title: 'Dashboard', file: assets.find((a) => a.id === 'dashboard')?.primary_path },
      { title: 'Abstract', file: assets.find((a) => a.id === 'abstract-background')?.primary_path },
      { title: 'Intro frame', file: assets.find((a) => a.id === 'video-intro-frame')?.primary_path },
    ];
    const existing = thumbs.filter((t) => t.file && (t.file.endsWith('.png') || t.file.endsWith('.svg'))) as Array<{ title: string; file: string }>;
    const cols = 3;
    const tileW = 760;
    const tileH = 470;
    const gutter = 34;
    const sheetW = cols * tileW + (cols + 1) * gutter;
    const rowsCount = Math.ceil(existing.length / cols);
    const sheetH = rowsCount * tileH + (rowsCount + 1) * gutter;
    const tiles = existing.map((item, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = gutter + col * (tileW + gutter);
      const y = gutter + row * (tileH + gutter);
      // Relative href from contact sheet location
      const href = path.relative(path.dirname(contactSheetPath), item.file).replace(/\\/g, '/');
      return { title: item.title, href, x, y, w: tileW, h: tileH };
    });
    await fs.writeFile(contactSheetPath, contactSheetSvg(tiles, sheetW, sheetH), 'utf8');
    validations.push(await validateFileNonEmpty(contactSheetPath));
  } catch (error: unknown) {
    // Contact sheet is optional; record as validation note in report.
    validations.push({ file: contactSheetPath, ok: false, note: `contact sheet failed: ${(error as Error).message}` });
  }

  const reportPath = path.join(benchDir, 'BENCHMARK_REPORT.md');
  const manifestPath = path.join(benchDir, 'manifest.md');

  const manualChecklist = [
    'Open each PNG/SVG and confirm: no title clipping, no subtitle clipping, no text overlap.',
    'Check safe margins: at least ~5% padding around major text blocks.',
    'At thumbnail scale: title readable, hierarchy clear, contrast sufficient.',
    'For hybrid cards: confirm overlay remains readable over the chosen background.',
    'For video: confirm it plays, looks intentional, and duration is correct.',
  ];

  const reportLines: string[] = [
    '# Visual Benchmark Report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Run id: \`${runId}\``,
    '',
    '## What this tests',
    '',
    'This benchmark suite tests multiple visual classes for code-first structured media generation:',
    'cards, diagrams, overlays, comparisons, UI mockups, abstract backgrounds, and video-as-code.',
    '',
    '## Results table',
    '',
    ...markdownTable(rows, projectRoot),
    '',
    '## Notes on “traditional AI” expectations',
    '',
    '- Pure code excels at layout, typography, diagrams, UI, and overlays.',
    '- Pure code does not replace photoreal scenic imagery; the correct approach is hybrid composition:',
    '  a local background (photo/stock/local ComfyUI) + deterministic overlay templates.',
    '',
    '## Manual visual review checklist',
    '',
    ...manualChecklist.map((line) => `- ${line}`),
    '',
    '## Validation',
    '',
    ...validations.map((v) => `- ${v.ok ? 'PASS' : 'FAIL'}: \`${path.relative(projectRoot, v.file).replace(/\\/g, '/')}\` - ${v.note}`),
    '',
    '## Next action',
    '',
    '- If any asset shows clipping/overlap, adjust its template/scene spec and rerun `npm run media:benchmark`.',
    '- If scenic realism is required, replace the local reference frame with a local ComfyUI output (still hybrid, still local-first).',
  ];
  await fs.writeFile(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  const manifestLines: string[] = [
    '# Visual Benchmark Manifest',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Run id: \`${runId}\``,
    '',
    '## Output folders',
    '',
    ...Object.entries(dirs).map(([key, dir]) => `- ${key}: \`${path.relative(projectRoot, dir).replace(/\\/g, '/')}\``),
    '',
    '## Assets',
    '',
    ...assets.map((asset) => `- ${asset.title} (${asset.renderer}) -> \`${path.relative(projectRoot, asset.primary_path).replace(/\\/g, '/')}\``),
    '',
    '## Contact sheet',
    '',
    `- \`${path.relative(projectRoot, contactSheetPath).replace(/\\/g, '/')}\``,
  ];
  await fs.writeFile(manifestPath, `${manifestLines.join('\n')}\n`, 'utf8');

  const gallery = await generateOutputGallery(outputRoot);

  return {
    run_id: runId,
    run_dir: runDir,
    manifest_path: manifestPath,
    report_path: reportPath,
    index_path: path.join(outputRoot, 'index.json'),
    gallery_path: gallery.html_path,
    assets,
    skipped: [],
  };
}
