import fs from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { HtmlCardInput, HtmlCardRenderResult } from '../types.js';
import { sanitizeFileStem } from './svgRenderer.js';

type FontSpec = {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: 'normal';
};

let cachedFonts: FontSpec[] | null = null;

function dims(template: HtmlCardInput['template'], width?: number, height?: number) {
  if (width && height) return { width, height };
  switch (template) {
    case 'project_hero_banner':
      return { width: 1600, height: 900 };
    case 'social_launch_card':
      return { width: 1200, height: 630 };
    case 'use_case_card':
      return { width: 1280, height: 720 };
    case 'feature_overview_card':
    case 'capability_card':
    default:
      return { width: 1280, height: 720 };
  }
}

async function loadFonts(): Promise<FontSpec[]> {
  if (cachedFonts) return cachedFonts;

  const candidates = [
    { name: 'Segoe UI', weight: 400 as const, file: 'C:\\Windows\\Fonts\\segoeui.ttf' },
    { name: 'Segoe UI', weight: 700 as const, file: 'C:\\Windows\\Fonts\\segoeuib.ttf' },
    { name: 'Arial', weight: 400 as const, file: 'C:\\Windows\\Fonts\\arial.ttf' },
    { name: 'Arial', weight: 700 as const, file: 'C:\\Windows\\Fonts\\arialbd.ttf' },
  ];

  const loaded: FontSpec[] = [];
  for (const candidate of candidates) {
    try {
      const data = await fs.readFile(candidate.file);
      loaded.push({ name: candidate.name, data, weight: candidate.weight, style: 'normal' });
    } catch {
      // Keep going; we only need one regular and one bold font to render.
    }
  }

  if (!loaded.some((font) => font.weight === 400) || !loaded.some((font) => font.weight === 700)) {
    throw new Error('HTML card renderer could not load local fonts. Cause: no supported Windows UI fonts were found. Suggested fix: install Segoe UI or Arial fonts, or run on a machine with standard Windows fonts.');
  }

  cachedFonts = loaded;
  return loaded;
}

function writeablePath(outputDir: string, outputName: string, extension: 'svg' | 'png'): string {
  const resolvedDir = path.resolve(outputDir);
  const outPath = path.resolve(resolvedDir, `${sanitizeFileStem(outputName)}.${extension}`);
  if (!(outPath === resolvedDir || outPath.startsWith(`${resolvedDir}${path.sep}`))) {
    throw new Error('Output path safety error. Cause: file path escaped output directory. Suggested fix: use a safe output_name.');
  }
  return outPath;
}

function badge(text: string, accent = '#7dd3fc') {
  return React.createElement('div', {
    style: {
      padding: '9px 14px',
      borderRadius: 14,
      background: 'rgba(10, 17, 31, 0.72)',
      border: `1px solid ${accent}33`,
      color: accent,
      fontSize: 18,
      fontWeight: 700,
      letterSpacing: 0.1,
      display: 'flex',
      alignItems: 'center',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
    },
  }, text);
}

function pipelineBlock(label: string, sublabel: string, accent: string) {
  return React.createElement('div', {
    style: {
      width: 250,
      minHeight: 150,
      borderRadius: 22,
      padding: '20px 20px 18px 20px',
      background: 'rgba(8, 14, 30, 0.92)',
      border: `1px solid ${accent}2c`,
      boxShadow: '0 16px 34px rgba(0, 0, 0, 0.18)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    },
  },
  React.createElement('div', {
    style: {
      width: 42,
      height: 8,
      borderRadius: 4,
      background: accent,
      boxShadow: `0 0 18px ${accent}26`,
    },
  }),
  React.createElement('div', { style: { fontSize: 27, fontWeight: 700, color: '#f8fafc', lineHeight: 1.12 } }, label),
  React.createElement('div', { style: { fontSize: 17, color: '#b8c4d9', lineHeight: 1.42 } }, sublabel));
}

function bulletList(items: string[], color = '#dce7f8') {
  return React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      width: '100%',
    },
  }, items.map((item, index) => React.createElement('div', {
    key: `${item}-${index}`,
    style: {
      display: 'flex',
      gap: 14,
      alignItems: 'flex-start',
      color,
      fontSize: 24,
      lineHeight: 1.36,
    },
  },
  React.createElement('div', {
    style: {
      width: 12,
      height: 3,
      borderRadius: 2,
      background: '#7dd3fc',
      marginTop: 15,
      flexShrink: 0,
    },
  }),
  React.createElement('div', { style: { display: 'flex' } }, item))));
}

function buildCard(input: HtmlCardInput, width: number, height: number): React.ReactElement {
  const bullets = (input.bullets ?? []).slice(0, 5);
  const badges = (input.badges ?? []).slice(0, 4);
  const footer = input.footer ?? 'Structure before randomness.';

  const shellStyle = {
    width,
    height,
    display: 'flex',
    flexDirection: 'column',
    background: 'linear-gradient(140deg, #08101f 0%, #0d172b 48%, #122236 100%)',
    color: '#f8fafc',
    position: 'relative' as const,
    overflow: 'hidden',
    padding: 56,
    fontFamily: '"Segoe UI", Arial, sans-serif',
  };

  const ambient = React.createElement(React.Fragment, {},
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: -120,
        top: -140,
        width: 520,
        height: 520,
        borderRadius: 999,
        background: 'radial-gradient(circle, rgba(46, 170, 255, 0.26) 0%, rgba(46, 170, 255, 0) 72%)',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        right: -160,
        bottom: -180,
        width: 560,
        height: 560,
        borderRadius: 999,
        background: 'radial-gradient(circle, rgba(64, 230, 161, 0.18) 0%, rgba(64, 230, 161, 0) 70%)',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        inset: 28,
        borderRadius: 30,
        border: '1px solid rgba(125, 211, 252, 0.16)',
      },
    }));

  if (input.template === 'project_hero_banner') {
    return React.createElement('div', { style: shellStyle },
      ambient,
      React.createElement('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 34,
        },
      },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 22, width: 720 } },
        badge(input.eyebrow ?? 'Local-first structured media pipeline'),
        React.createElement('div', {
          style: {
            fontSize: 84,
            fontWeight: 760,
            lineHeight: 0.96,
            letterSpacing: -3.6,
            maxWidth: 760,
          },
        }, input.title),
        React.createElement('div', {
          style: {
            fontSize: 28,
            lineHeight: 1.34,
            color: '#c7d7ea',
            maxWidth: 740,
          },
        }, input.subtitle),
        React.createElement('div', {
          style: {
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            marginTop: 8,
          },
        }, badges.map((item, index) => badge(item, ['#7dd3fc', '#93c5fd', '#86efac', '#facc15'][index % 4]))),
      ),
      React.createElement('div', {
        style: {
          width: 520,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 18,
          alignContent: 'flex-start',
          justifyContent: 'flex-end',
        },
      },
      pipelineBlock('Claude / Agent', 'Media brief, asset plan, renderer selection.', '#7dd3fc'),
      pipelineBlock('Local MCP Runner', 'Versioned templates, render orchestration, validation.', '#93c5fd'),
      pipelineBlock('Outputs + Logs', 'Inspectable PNG, SVG, MP4, manifests, reports, and run folders.', '#86efac'))),
      React.createElement('div', {
        style: {
          marginTop: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          alignItems: 'flex-start',
        },
      },
      bulletList(bullets.length ? bullets : [
        'Code-rendered hero assets, diagrams, and launch cards come first.',
        'Local ComfyUI stays optional for realism, not mandatory for the pipeline.',
        'Every run lands in organized folders with manifests and honest reports.',
      ]),
      React.createElement('div', {
        style: {
          color: '#9db3cf',
          fontSize: 22,
          fontWeight: 600,
        },
      }, footer)));
  }

  if (input.template === 'social_launch_card') {
    const socialRight = React.createElement('div', {
      style: {
        width: 280,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      },
    },
    pipelineBlock('Code-first', 'Precise cards, diagrams, and layout-controlled assets.', '#7dd3fc'),
    pipelineBlock('Local-first', 'No hosted service and no required cloud key for the core path.', '#86efac'));

    return React.createElement('div', { style: shellStyle },
      ambient,
      React.createElement('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 28,
        },
      },
      React.createElement('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          width: 760,
        },
      },
      badge(input.eyebrow ?? 'Launch-ready local media tooling'),
      React.createElement('div', {
        style: {
          fontSize: 64,
          lineHeight: 0.99,
          fontWeight: 760,
          letterSpacing: -2.4,
          maxWidth: 760,
        },
      }, input.title),
      React.createElement('div', {
        style: {
          fontSize: 26,
          lineHeight: 1.34,
          color: '#c7d7ea',
          maxWidth: 740,
        },
      }, input.subtitle),
      React.createElement('div', {
        style: { display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 2 },
      }, badges.map((item, index) => badge(item, ['#7dd3fc', '#86efac', '#facc15', '#c4b5fd'][index % 4])))),
      socialRight),
      React.createElement('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 16,
          marginTop: 'auto',
          paddingTop: 22,
        },
      },
      React.createElement('div', { style: { width: 760, display: 'flex', flexDirection: 'column' } }, bulletList(bullets.length ? bullets : [
        'Run structured media workflows from Claude.',
        'Generate cards, diagrams, and video-as-code outputs locally.',
      ])),
      React.createElement('div', { style: { color: '#9db3cf', fontSize: 22, fontWeight: 600 } }, footer)));
  }

  const rightPanel = React.createElement('div', {
    style: {
      width: 420,
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
      padding: 28,
      borderRadius: 30,
      background: 'rgba(8, 16, 30, 0.88)',
      border: '1px solid rgba(125, 211, 252, 0.16)',
      boxShadow: '0 18px 46px rgba(0,0,0,0.22)',
    },
  },
  React.createElement('div', { style: { fontSize: 16, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 2.2 } }, input.eyebrow ?? 'Media pipeline'),
  React.createElement('div', { style: { fontSize: 34, lineHeight: 1.08, fontWeight: 720 } }, 'Structured outputs'),
  React.createElement('div', { style: { fontSize: 20, lineHeight: 1.45, color: '#c7d7ea' } }, 'Every run lands in an inspectable folder with source files, raster outputs, manifests, and a report.'),
  React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    badge('PNG + SVG + MP4', '#86efac'),
    badge('No hosted server required', '#7dd3fc'),
    badge('ComfyUI optional later', '#c4b5fd')));

  const leftPanel = React.createElement('div', {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
    },
  },
  badge(input.eyebrow ?? (input.template === 'feature_overview_card' ? 'Current capabilities' : 'Honest status')),
  React.createElement('div', {
    style: {
      fontSize: 68,
      lineHeight: 0.98,
      fontWeight: 760,
      letterSpacing: -2.4,
      maxWidth: 700,
    },
  }, input.title),
  React.createElement('div', {
    style: {
      fontSize: 28,
      lineHeight: 1.35,
      color: '#c7d7ea',
      maxWidth: 720,
    },
  }, input.subtitle),
  bulletList(bullets.length ? bullets : [
    'Readable templates with deterministic dimensions.',
    'Professional launch assets built for README and social posts.',
    'Structured run folders instead of one-off generated junk.',
  ]),
  React.createElement('div', {
    style: {
      marginTop: 'auto',
      display: 'flex',
      gap: 12,
      flexWrap: 'wrap',
    },
  }, badges.map((item, index) => badge(item, ['#7dd3fc', '#86efac', '#facc15', '#c4b5fd'][index % 4]))));

  const footerBar = React.createElement('div', {
    style: {
      position: 'absolute',
      left: 56,
      right: 56,
      bottom: 38,
      display: 'flex',
      justifyContent: 'space-between',
      color: '#90a5c2',
      fontSize: 20,
    },
  },
  React.createElement('div', {}, footer),
  React.createElement('div', {}, input.template === 'capability_card'
    ? 'Works now vs planned later'
    : input.template === 'use_case_card'
      ? 'Practical use case card'
      : 'Developer-tool visual system'));

  if (input.template === 'use_case_card') {
    const overlayHeader = React.createElement('div', {
      style: {
        position: 'absolute',
        left: 56,
        right: 56,
        top: 56,
        padding: '26px 30px',
        borderRadius: 30,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(8, 16, 30, 0.72)',
        border: '1px solid rgba(125, 211, 252, 0.16)',
        boxShadow: '0 22px 70px rgba(0,0,0,0.25)',
      },
    },
    React.createElement('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 } },
      badge(input.eyebrow ?? 'Practical use case', '#7dd3fc'),
      badge('Deterministic overlay', '#86efac'),
      badge('Reusable template', '#93c5fd')),
    React.createElement('div', { style: { fontSize: 58, fontWeight: 820, letterSpacing: -2.2, lineHeight: 0.98, maxWidth: 980 } }, input.title),
    React.createElement('div', { style: { fontSize: 26, color: '#c7d7ea', lineHeight: 1.3, marginTop: 14, maxWidth: 980 } }, input.subtitle));

    const backgroundStage = React.createElement('div', {
      style: {
        position: 'absolute',
        left: 56,
        right: 56,
        top: 360,
        bottom: 110,
        borderRadius: 34,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: 28,
        background: 'rgba(2, 6, 23, 0.58)',
        border: '1px solid rgba(148, 163, 184, 0.16)',
        boxShadow: '0 28px 80px rgba(0,0,0,0.32)',
      },
    },
    React.createElement('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 } },
      badge('Travel thumbnail', '#7dd3fc'),
      badge('Quote card', '#86efac'),
      badge('Educational explainer', '#facc15')),
    React.createElement('div', { style: { width: 760, color: '#c7d7ea', fontSize: 22, lineHeight: 1.4 } },
      'This is the correct role for code-first media: lock the overlay layout and text. The background can be swapped later (photo, stock, or local ComfyUI) without breaking hierarchy.'));

    return React.createElement('div', { style: shellStyle }, ambient, overlayHeader, backgroundStage, footerBar);
  }

  return React.createElement('div', { style: shellStyle },
    ambient,
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: 34,
      },
    }, leftPanel, rightPanel),
    footerBar);
}

export async function renderHtmlCard(input: HtmlCardInput, outputDir: string): Promise<HtmlCardRenderResult> {
  const { width, height } = dims(input.template, input.width, input.height);
  const outputName = input.output_name ?? `${input.template}-${Date.now()}`;
  const svgPath = writeablePath(outputDir, outputName, 'svg');
  const pngPath = writeablePath(outputDir, outputName, 'png');
  await fs.mkdir(path.resolve(outputDir), { recursive: true });

  const textFragments = [input.eyebrow ?? '', input.title, input.subtitle, ...(input.bullets ?? []), ...(input.badges ?? []), input.footer ?? 'Structure before randomness.'].filter(Boolean);
  const svg = await satori(buildCard(input, width, height), {
    width,
    height,
    fonts: await loadFonts(),
  });
  const metadataComment = `<!-- text-fragments: ${textFragments.map((fragment) => fragment.replace(/--/g, '—')).join(' | ')} -->\n`;
  const svgWithMetadata = `${metadataComment}${svg}`;

  const resvg = new Resvg(svgWithMetadata, {
    fitTo: {
      mode: 'width',
      value: width,
    },
  });
  const png = resvg.render().asPng();

  await fs.writeFile(svgPath, svgWithMetadata, 'utf8');
  await fs.writeFile(pngPath, png);

  return {
    status: 'ok',
    template: input.template,
    svg_path: svgPath,
    png_path: pngPath,
    width,
    height,
    warnings: [],
    text_fragments: textFragments,
  };
}
