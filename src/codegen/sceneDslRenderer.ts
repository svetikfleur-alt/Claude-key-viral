import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type {
  CodegenSceneInput,
  SvgSceneGradientDef,
  SvgSceneImageNode,
  SvgSceneNode,
  SvgSceneRenderInput,
  SvgSceneRenderResult,
  SvgSceneSpec,
  SvgSceneStackNode,
  SvgSceneTextNode,
  SvgSceneVideoInput,
} from '../types.js';
import { renderRemotionVideo } from './remotionRenderer.js';
import { sanitizeFileStem } from './svgRenderer.js';

type RenderContext = {
  clipIndex: number;
  clipDefs: string[];
  textFragments: string[];
};

type NodeSize = {
  width: number;
  height: number;
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attr(name: string, value: string | number | undefined): string {
  if (value === undefined) return '';
  return ` ${name}="${typeof value === 'number' ? value : esc(value)}"`;
}

function paintAttrs(node: {
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  opacity?: number;
  filter?: string;
  transform?: string;
}): string {
  return [
    attr('fill', node.fill ?? 'transparent'),
    attr('stroke', node.stroke ?? 'none'),
    attr('stroke-width', node.stroke_width ?? 1),
    attr('opacity', node.opacity ?? 1),
    node.filter ? attr('filter', `url(#${node.filter})`) : '',
    attr('transform', node.transform),
  ].join('');
}

function lineAttrs(node: {
  stroke: string;
  stroke_width?: number;
  opacity?: number;
  stroke_linecap?: 'butt' | 'round' | 'square';
  transform?: string;
}): string {
  return [
    attr('stroke', node.stroke),
    attr('stroke-width', node.stroke_width ?? 1),
    attr('opacity', node.opacity ?? 1),
    attr('stroke-linecap', node.stroke_linecap),
    attr('transform', node.transform),
  ].join('');
}

function validateSceneSpec(scene: SvgSceneSpec): void {
  if (!Number.isFinite(scene.width) || !Number.isFinite(scene.height) || scene.width <= 0 || scene.height <= 0) {
    throw new Error('Invalid SVG scene size. Cause: width and height must be positive numbers. Suggested fix: provide deterministic dimensions.');
  }
  if (!Array.isArray(scene.nodes)) {
    throw new Error('Invalid SVG scene nodes. Cause: scene.nodes must be an array. Suggested fix: pass a structured scene spec.');
  }
  const ids = new Set<string>();
  for (const gradient of scene.defs?.gradients ?? []) {
    if (!gradient.id || ids.has(gradient.id)) {
      throw new Error(`Invalid SVG scene definition. Cause: duplicate or empty gradient id "${gradient.id}". Suggested fix: give every gradient a stable unique id.`);
    }
    if (!Array.isArray(gradient.stops) || gradient.stops.length === 0) {
      throw new Error(`Invalid SVG scene definition. Cause: gradient "${gradient.id}" has no stops. Suggested fix: provide at least one color stop.`);
    }
    ids.add(gradient.id);
  }
  for (const filter of scene.defs?.filters ?? []) {
    if (!filter.id || ids.has(filter.id)) {
      throw new Error(`Invalid SVG scene definition. Cause: duplicate or empty filter id "${filter.id}". Suggested fix: give every filter a stable unique id.`);
    }
    ids.add(filter.id);
  }
}

function ensureOutputPath(outputDir: string, fileStem: string, extension: 'svg' | 'png'): string {
  const resolvedDir = path.resolve(outputDir);
  const outPath = path.resolve(resolvedDir, `${sanitizeFileStem(fileStem)}.${extension}`);
  if (!(outPath === resolvedDir || outPath.startsWith(`${resolvedDir}${path.sep}`))) {
    throw new Error('Output path safety error. Cause: file path escaped output directory. Suggested fix: use a safe output_name.');
  }
  return outPath;
}

function wrapText(text: string, maxWidth: number | undefined, fontSize: number): string[] {
  const clean = text.trim();
  if (!clean) return [''];
  if (!maxWidth || maxWidth <= 0) return clean.split('\n');
  const approximateChars = Math.max(10, Math.floor(maxWidth / Math.max(7, fontSize * 0.56)));
  const lines: string[] = [];
  for (const block of clean.split('\n')) {
    const words = block.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= approximateChars) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

function measureTextNode(node: SvgSceneTextNode): NodeSize {
  const lines = wrapText(node.text, node.width, node.font_size);
  const lineHeight = node.line_height ?? 1.25;
  const height = Math.max(node.font_size, Math.ceil(lines.length * node.font_size * lineHeight));
  const width = node.width ?? Math.ceil(Math.max(...lines.map((line) => line.length), 1) * node.font_size * 0.58);
  return { width, height };
}

function measureNode(node: SvgSceneNode): NodeSize {
  switch (node.kind) {
    case 'rect':
    case 'image':
      return { width: node.width, height: node.height };
    case 'line':
      return { width: Math.abs(node.x2 - node.x1), height: Math.abs(node.y2 - node.y1) };
    case 'circle':
      return { width: node.r * 2, height: node.r * 2 };
    case 'ellipse':
      return { width: node.rx * 2, height: node.ry * 2 };
    case 'path':
      return { width: 0, height: 0 };
    case 'polygon':
      return measurePolygonNode(node.points);
    case 'text':
      return measureTextNode(node);
    case 'group': {
      const widths = node.children.map((child) => measureNode(child).width);
      const heights = node.children.map((child) => measureNode(child).height);
      return {
        width: widths.length ? Math.max(...widths) : 0,
        height: heights.length ? Math.max(...heights) : 0,
      };
    }
    case 'stack': {
      const padding = node.padding ?? 0;
      const gap = node.gap ?? 0;
      const childSizes = node.children.map((child) => measureNode(child));
      if (node.direction === 'vertical') {
        const height = padding * 2 + childSizes.reduce((sum, size) => sum + size.height, 0) + Math.max(0, childSizes.length - 1) * gap;
        const width = node.width;
        return { width, height: node.height ?? height };
      }
      const width = padding * 2 + childSizes.reduce((sum, size) => sum + size.width, 0) + Math.max(0, childSizes.length - 1) * gap;
      const height = padding * 2 + (childSizes.length ? Math.max(...childSizes.map((size) => size.height)) : 0);
      return { width: node.width || width, height: node.height ?? height };
    }
  }
}

function measurePolygonNode(points: string | Array<[number, number]>): NodeSize {
  const tuples = Array.isArray(points)
    ? points
    : points.trim().split(/\s+/).map((pair) => pair.split(',').map(Number) as [number, number]);
  const clean = tuples.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (clean.length === 0) return { width: 0, height: 0 };
  const xs = clean.map(([x]) => x);
  const ys = clean.map(([, y]) => y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function translateNode(node: SvgSceneNode, dx: number, dy: number): SvgSceneNode {
  switch (node.kind) {
    case 'rect':
      return { ...node, x: node.x + dx, y: node.y + dy };
    case 'line':
      return { ...node, x1: node.x1 + dx, y1: node.y1 + dy, x2: node.x2 + dx, y2: node.y2 + dy };
    case 'circle':
      return { ...node, cx: node.cx + dx, cy: node.cy + dy };
    case 'ellipse':
      return { ...node, cx: node.cx + dx, cy: node.cy + dy };
    case 'path':
      return { ...node, transform: combineTransforms(`translate(${dx} ${dy})`, node.transform) };
    case 'polygon':
      return {
        ...node,
        points: translatePolygonPoints(node.points, dx, dy),
      };
    case 'text':
      return { ...node, x: node.x + dx, y: node.y + dy };
    case 'image':
      return { ...node, x: node.x + dx, y: node.y + dy };
    case 'group':
      return {
        ...node,
        x: (node.x ?? 0) + dx,
        y: (node.y ?? 0) + dy,
      };
    case 'stack':
      return {
        ...node,
        x: node.x + dx,
        y: node.y + dy,
        children: node.children.map((child) => translateNode(child, dx, dy)),
      };
  }
}

function combineTransforms(...values: Array<string | undefined>): string | undefined {
  const clean = values.map((value) => value?.trim()).filter(Boolean);
  return clean.length ? clean.join(' ') : undefined;
}

function translatePolygonPoints(points: string | Array<[number, number]>, dx: number, dy: number): string | Array<[number, number]> {
  if (Array.isArray(points)) {
    return points.map(([x, y]) => [x + dx, y + dy]);
  }
  return points.trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return pair;
    return `${x + dx},${y + dy}`;
  }).join(' ');
}

function renderTextNode(node: SvgSceneTextNode, context: RenderContext): string {
  const lines = wrapText(node.text, node.width, node.font_size);
  const lineHeight = node.line_height ?? 1.25;
  const fill = node.fill ?? '#f8fafc';
  const fontFamily = node.font_family ?? 'Segoe UI, Arial, sans-serif';
  const textAnchor = node.align === 'center' ? 'middle' : node.align === 'right' ? 'end' : 'start';
  const baseX = node.align === 'center'
    ? node.x + (node.width ?? 0) / 2
    : node.align === 'right'
      ? node.x + (node.width ?? 0)
      : node.x;
  context.textFragments.push(node.text);
  const tspans = lines.map((line, index) => (
    `<tspan x="${baseX}" dy="${index === 0 ? node.font_size : node.font_size * lineHeight}">${esc(line)}</tspan>`
  )).join('');
  return `<text x="${baseX}" y="${node.y}" fill="${fill}" font-size="${node.font_size}" font-family="${esc(fontFamily)}" font-style="${esc(node.font_style ?? 'normal')}" font-weight="${node.font_weight ?? 400}" text-decoration="${esc(node.text_decoration ?? 'none')}" letter-spacing="${node.letter_spacing ?? 0}" text-anchor="${textAnchor}" opacity="${node.opacity ?? 1}"${node.filter ? attr('filter', `url(#${node.filter})`) : ''}${attr('transform', node.transform)}>${tspans}</text>`;
}

function renderImageNode(node: SvgSceneImageNode, context: RenderContext): string {
  const href = esc(node.href);
  const preserveAspectRatio = node.preserve_aspect === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
  const extras = `${attr('opacity', node.opacity ?? 1)}${node.filter ? attr('filter', `url(#${node.filter})`) : ''}${attr('transform', node.transform)}`;
  if (!node.radius) {
    return `<image href="${href}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" preserveAspectRatio="${preserveAspectRatio}"${extras}/>`;
  }
  const clipId = `sceneClip${context.clipIndex++}`;
  context.clipDefs.push(`<clipPath id="${clipId}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.radius}" ry="${node.radius}"/></clipPath>`);
  return `<image href="${href}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" preserveAspectRatio="${preserveAspectRatio}"${extras} clip-path="url(#${clipId})"/><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.radius}" ry="${node.radius}" fill="none" stroke="rgba(255,255,255,0.08)"/>`;
}

function renderStackNode(node: SvgSceneStackNode, context: RenderContext): string {
  const padding = node.padding ?? 0;
  const gap = node.gap ?? 0;
  const align = node.align ?? 'start';
  const rendered: string[] = [];
  const nodeSize = measureNode(node);
  if (node.fill || node.stroke) {
    rendered.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height ?? nodeSize.height}" rx="${node.radius ?? 0}" ry="${node.radius ?? 0}"${paintAttrs(node)}/>`);
  }

  let cursorX = node.x + padding;
  let cursorY = node.y + padding;
  const innerWidth = node.width - padding * 2;

  for (const child of node.children) {
    const childSize = measureNode(child);
    let placedX = cursorX;
    let placedY = cursorY;
    if (node.direction === 'vertical') {
      if (align === 'center') placedX = node.x + padding + Math.max(0, (innerWidth - childSize.width) / 2);
      if (align === 'end') placedX = node.x + padding + Math.max(0, innerWidth - childSize.width);
      rendered.push(renderNode(translateNode(child, placedX - getOriginX(child), placedY - getOriginY(child)), context));
      cursorY += childSize.height + gap;
    } else {
      const stackHeight = (node.height ?? nodeSize.height) - padding * 2;
      if (align === 'center') placedY = node.y + padding + Math.max(0, (stackHeight - childSize.height) / 2);
      if (align === 'end') placedY = node.y + padding + Math.max(0, stackHeight - childSize.height);
      rendered.push(renderNode(translateNode(child, placedX - getOriginX(child), placedY - getOriginY(child)), context));
      cursorX += childSize.width + gap;
    }
  }

  const markup = rendered.join('');
  if (node.filter || node.transform) {
    return `<g${node.filter ? attr('filter', `url(#${node.filter})`) : ''}${attr('transform', node.transform)}>${markup}</g>`;
  }
  return markup;
}

function getOriginX(node: SvgSceneNode): number {
  switch (node.kind) {
    case 'rect':
    case 'text':
    case 'image':
    case 'stack':
      return node.x;
    case 'line':
      return node.x1;
    case 'circle':
      return node.cx - node.r;
    case 'ellipse':
      return node.cx - node.rx;
    case 'path':
      return 0;
    case 'polygon':
      return 0;
    case 'group':
      return node.x ?? 0;
  }
}

function getOriginY(node: SvgSceneNode): number {
  switch (node.kind) {
    case 'rect':
    case 'text':
    case 'image':
    case 'stack':
      return node.y;
    case 'line':
      return node.y1;
    case 'circle':
      return node.cy - node.r;
    case 'ellipse':
      return node.cy - node.ry;
    case 'path':
      return 0;
    case 'polygon':
      return 0;
    case 'group':
      return node.y ?? 0;
  }
}

function renderPolygonPoints(points: string | Array<[number, number]>): string {
  return Array.isArray(points)
    ? points.map(([x, y]) => `${x},${y}`).join(' ')
    : points;
}

function renderNode(node: SvgSceneNode, context: RenderContext): string {
  switch (node.kind) {
    case 'rect':
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.radius ?? 0}" ry="${node.radius ?? 0}"${paintAttrs(node)}/>`;
    case 'line':
      return `<line x1="${node.x1}" y1="${node.y1}" x2="${node.x2}" y2="${node.y2}"${lineAttrs(node)}/>`;
    case 'circle':
      return `<circle cx="${node.cx}" cy="${node.cy}" r="${node.r}"${paintAttrs(node)}/>`;
    case 'ellipse':
      return `<ellipse cx="${node.cx}" cy="${node.cy}" rx="${node.rx}" ry="${node.ry}"${paintAttrs(node)}/>`;
    case 'path':
      return `<path d="${esc(node.d)}"${[
        attr('fill', node.fill ?? 'none'),
        attr('stroke', node.stroke ?? 'none'),
        attr('stroke-width', node.stroke_width ?? 1),
        attr('opacity', node.opacity ?? 1),
        attr('stroke-linecap', node.stroke_linecap),
        attr('stroke-linejoin', node.stroke_linejoin),
        node.filter ? attr('filter', `url(#${node.filter})`) : '',
        attr('transform', node.transform),
      ].join('')}/>`;
    case 'polygon':
      return `<polygon points="${esc(renderPolygonPoints(node.points))}"${paintAttrs(node)}/>`;
    case 'text':
      return renderTextNode(node, context);
    case 'image':
      return renderImageNode(node, context);
    case 'group':
      return `<g${attr('opacity', node.opacity ?? 1)}${node.filter ? attr('filter', `url(#${node.filter})`) : ''}${attr('transform', combineTransforms(`translate(${node.x ?? 0} ${node.y ?? 0})`, node.transform))}>${node.children.map((child) => renderNode(child, context)).join('')}</g>`;
    case 'stack':
      return renderStackNode(node, context);
  }
}

function renderGradientDef(def: SvgSceneGradientDef): string {
  const stops = def.stops.map((stop) => (
    `<stop offset="${esc(stop.offset)}" stop-color="${esc(stop.color)}"${attr('stop-opacity', stop.opacity)} />`
  )).join('');
  if (def.type === 'radial') {
    return `<radialGradient id="${esc(def.id)}"${attr('cx', def.cx ?? '50%')}${attr('cy', def.cy ?? '50%')}${attr('r', def.r ?? '50%')}${attr('fx', def.fx)}${attr('fy', def.fy)}>${stops}</radialGradient>`;
  }
  return `<linearGradient id="${esc(def.id)}"${attr('x1', def.x1 ?? '0%')}${attr('y1', def.y1 ?? '0%')}${attr('x2', def.x2 ?? '100%')}${attr('y2', def.y2 ?? '100%')}>${stops}</linearGradient>`;
}

function renderSceneDefs(scene: SvgSceneSpec, context: RenderContext): string {
  const gradients = (scene.defs?.gradients ?? []).map(renderGradientDef);
  const filters = (scene.defs?.filters ?? []).map((filter) => (
    `<filter id="${esc(filter.id)}" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="${filter.dx ?? 0}" dy="${filter.dy ?? 18}" stdDeviation="${filter.std_deviation ?? 22}" flood-color="${esc(filter.color ?? '#000000')}" flood-opacity="${filter.opacity ?? 0.35}"/></filter>`
  ));
  const defs = [...gradients, ...filters, ...context.clipDefs];
  return defs.length ? `<defs>${defs.join('')}</defs>` : '';
}

export function buildSvgSceneMarkup(scene: SvgSceneSpec): { svg_markup: string; text_fragments: string[] } {
  validateSceneSpec(scene);
  const context: RenderContext = {
    clipIndex: 0,
    clipDefs: [],
    textFragments: [],
  };
  const nodesMarkup = scene.nodes.map((node) => renderNode(node, context)).join('');
  const defs = renderSceneDefs(scene, context);
  const background = scene.background
    ? `<rect width="${scene.width}" height="${scene.height}" fill="${scene.background}"/>`
    : '';
  const metadataComment = `<!-- text-fragments: ${context.textFragments.map((fragment) => fragment.replace(/--/g, '—')).join(' | ')} -->\n`;
  return {
    svg_markup: `${metadataComment}<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">${defs}${background}${nodesMarkup}</svg>`,
    text_fragments: context.textFragments,
  };
}

async function writeSvgFile(filePath: string, svgMarkup: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, svgMarkup, 'utf8');
}

async function writePngFile(filePath: string, svgMarkup: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await sharp(Buffer.from(svgMarkup)).png().toFile(filePath);
}

export async function renderSvgScene(input: SvgSceneRenderInput, outputDir: string): Promise<SvgSceneRenderResult> {
  validateSceneSpec(input.scene);
  const outputName = input.output_name ?? `scene-${Date.now()}`;
  const svgPath = ensureOutputPath(outputDir, outputName, 'svg');
  const pngPath = input.rasterize_png === false ? undefined : ensureOutputPath(outputDir, outputName, 'png');
  const built = buildSvgSceneMarkup(input.scene);
  await writeSvgFile(svgPath, built.svg_markup);
  if (pngPath) {
    await writePngFile(pngPath, built.svg_markup);
  }
  return {
    status: 'ok',
    svg_path: svgPath,
    png_path: pngPath,
    width: input.scene.width,
    height: input.scene.height,
    warnings: [],
    text_fragments: built.text_fragments,
  };
}

function toDataUrl(svgMarkup: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svgMarkup).toString('base64')}`;
}

export async function renderSvgSceneVideo(input: SvgSceneVideoInput, outputDir: string): Promise<Awaited<ReturnType<typeof renderRemotionVideo>>> {
  const sceneCards = input.scenes.map((scene, index) => {
    const built = buildSvgSceneMarkup(scene.scene);
    const duration = scene.duration_seconds ?? 4;
    return {
      headline: scene.headline ?? `Scene ${index + 1}`,
      body: scene.body ?? 'SVG scene rendered from structured code.',
      accent: scene.accent ?? `Beat ${String(index + 1).padStart(2, '0')}`,
      media_data_url: toDataUrl(built.svg_markup),
      duration_seconds: duration,
    } satisfies CodegenSceneInput & { duration_seconds: number };
  });
  const totalDuration = sceneCards.reduce((sum, scene) => sum + scene.duration_seconds, 0);
  return await renderRemotionVideo({
    title: input.title,
    subtitle: input.subtitle,
    theme: input.theme ?? 'slate',
    visual_style: 'scene_sequence',
    scenes: sceneCards,
    width: input.width ?? input.scenes[0]?.scene.width ?? 1280,
    height: input.height ?? input.scenes[0]?.scene.height ?? 720,
    fps: input.fps ?? 24,
    duration_seconds: Math.max(totalDuration, input.scenes.length * 3),
    output_name: input.output_name,
  }, outputDir);
}
