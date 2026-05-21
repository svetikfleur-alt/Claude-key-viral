import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { SvgMarkupInput, SvgTemplateInput } from '../types.js';

export type TemplateName = SvgTemplateInput['template'];

export interface RenderCodeImageResult {
  status: 'ok';
  template: TemplateName | 'raw_svg_markup';
  file_path: string;
  width: number;
  height: number;
  warnings: string[];
}

export interface RenderCodePngResult {
  status: 'ok';
  file_path: string;
  width: number;
  height: number;
  warnings: string[];
}

export function sanitizeFileStem(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!s) throw new Error('Invalid output_name. Cause: name became empty after sanitization. Suggested fix: use letters, numbers, dash, underscore.');
  return s;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function dims(template: TemplateName, width?: number, height?: number) {
  if (width && height) return { width, height };
  if (template === 'github_hero_banner') return { width: 1600, height: 900 };
  if (template === 'pipeline_diagram') return { width: 1600, height: 900 };
  if (template === 'social_launch_card') return { width: 1200, height: 630 };
  return { width: 1200, height: 800 };
}

function renderTemplate(input: SvgTemplateInput, width: number, height: number): string {
  const title = esc(input.title);
  const subtitle = esc(input.subtitle ?? '');
  const bullets = (input.bullets ?? []).slice(0, 5).map((b) => esc(b));

  const baseStart = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0B1220"/><stop offset="100%" stop-color="#1F2A44"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/>`;
  const footer = `</svg>`;

  if (input.template === 'pipeline_diagram') {
    return `${baseStart}
      <text x="80" y="90" fill="#E6EEF8" font-size="54" font-family="Inter,Arial,sans-serif" font-weight="700">${title}</text>
      <text x="80" y="138" fill="#B8C7DD" font-size="26" font-family="Inter,Arial,sans-serif">${subtitle}</text>
      <rect x="80" y="240" rx="18" ry="18" width="290" height="120" fill="#243654" stroke="#4B6A9B"/>
      <rect x="470" y="240" rx="18" ry="18" width="290" height="120" fill="#243654" stroke="#4B6A9B"/>
      <rect x="860" y="240" rx="18" ry="18" width="290" height="120" fill="#243654" stroke="#4B6A9B"/>
      <rect x="1250" y="240" rx="18" ry="18" width="270" height="120" fill="#243654" stroke="#4B6A9B"/>
      <text x="115" y="310" fill="#E6EEF8" font-size="30" font-family="Inter,Arial,sans-serif">Claude Desktop</text>
      <text x="507" y="310" fill="#E6EEF8" font-size="30" font-family="Inter,Arial,sans-serif">MCP Runner</text>
      <text x="915" y="310" fill="#E6EEF8" font-size="30" font-family="Inter,Arial,sans-serif">Local ComfyUI</text>
      <text x="1290" y="310" fill="#E6EEF8" font-size="30" font-family="Inter,Arial,sans-serif">Outputs</text>
      <line x1="370" y1="300" x2="470" y2="300" stroke="#8FB3FF" stroke-width="6"/>
      <line x1="760" y1="300" x2="860" y2="300" stroke="#8FB3FF" stroke-width="6"/>
      <line x1="1150" y1="300" x2="1250" y2="300" stroke="#8FB3FF" stroke-width="6"/>
    ${footer}`;
  }

  const bulletSvg = bullets.map((b, i) => `<text x="100" y="${330 + i * 58}" fill="#C7D7F0" font-size="30" font-family="Inter,Arial,sans-serif">• ${b}</text>`).join('');
  return `${baseStart}
    <rect x="70" y="70" width="${width - 140}" height="${height - 140}" rx="24" ry="24" fill="rgba(10,16,28,0.42)" stroke="#3D5480"/>
    <text x="100" y="170" fill="#F2F7FF" font-size="${input.template === 'social_launch_card' ? 64 : 72}" font-family="Inter,Arial,sans-serif" font-weight="700">${title}</text>
    <text x="100" y="235" fill="#AFC3E6" font-size="32" font-family="Inter,Arial,sans-serif">${subtitle}</text>
    ${bulletSvg}
    <text x="100" y="${height - 90}" fill="#8BA7D6" font-size="24" font-family="Inter,Arial,sans-serif">local-first • no hosted server • reproducible assets</text>
  ${footer}`;
}

function parseSvgDimensions(svgMarkup: string): { width: number; height: number } {
  const widthMatch = svgMarkup.match(/\bwidth=["'](\d+(?:\.\d+)?)["']/i);
  const heightMatch = svgMarkup.match(/\bheight=["'](\d+(?:\.\d+)?)["']/i);
  const viewBoxMatch = svgMarkup.match(/\bviewBox=["'][^"']*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)["']/i);
  const width = widthMatch ? Number(widthMatch[1]) : (viewBoxMatch ? Number(viewBoxMatch[1]) : 1200);
  const height = heightMatch ? Number(heightMatch[1]) : (viewBoxMatch ? Number(viewBoxMatch[2]) : 800);
  return { width, height };
}

async function writeSvgFile(outPath: string, svgMarkup: string): Promise<void> {
  const outBase = path.resolve(path.dirname(outPath));
  if (!(outPath === outBase || outPath.startsWith(`${outBase}${path.sep}`))) {
    throw new Error('Output path safety error. Cause: file path escaped output directory. Suggested fix: use a safe output_name.');
  }
  await fs.mkdir(outBase, { recursive: true });
  await fs.writeFile(outPath, svgMarkup, 'utf8');
}

async function writePngFile(outPath: string, svgMarkup: string): Promise<void> {
  const outBase = path.resolve(path.dirname(outPath));
  if (!(outPath === outBase || outPath.startsWith(`${outBase}${path.sep}`))) {
    throw new Error('Output path safety error. Cause: file path escaped output directory. Suggested fix: use a safe output_name.');
  }
  await fs.mkdir(outBase, { recursive: true });
  await sharp(Buffer.from(svgMarkup)).png().toFile(outPath);
}

export async function renderCodeImage(input: SvgTemplateInput, outputDir: string): Promise<RenderCodeImageResult> {
  const { width, height } = dims(input.template, input.width, input.height);
  const outName = sanitizeFileStem(input.output_name ?? `${input.template}-${Date.now()}`);
  const outPath = path.resolve(outputDir, `${outName}.svg`);
  const svg = renderTemplate(input, width, height);
  await writeSvgFile(outPath, svg);
  return { status: 'ok', template: input.template, file_path: outPath, width, height, warnings: [] };
}

export async function saveSvgMarkup(input: SvgMarkupInput, outputDir: string): Promise<RenderCodeImageResult> {
  const outName = sanitizeFileStem(input.output_name ?? `svg-markup-${Date.now()}`);
  const outPath = path.resolve(outputDir, `${outName}.svg`);
  await writeSvgFile(outPath, input.svg_markup);
  const { width, height } = parseSvgDimensions(input.svg_markup);
  return {
    status: 'ok',
    template: 'raw_svg_markup',
    file_path: outPath,
    width,
    height,
    warnings: input.svg_markup.includes('<svg') ? [] : ['The provided markup did not contain a detectable <svg> tag. The file was still written as-is.'],
  };
}

export async function saveSvgMarkupAsPng(input: SvgMarkupInput, outputDir: string): Promise<RenderCodePngResult> {
  const outName = sanitizeFileStem(input.output_name ?? `svg-markup-${Date.now()}`);
  const outPath = path.resolve(outputDir, `${outName}.png`);
  await writePngFile(outPath, input.svg_markup);
  const { width, height } = parseSvgDimensions(input.svg_markup);
  return {
    status: 'ok',
    file_path: outPath,
    width,
    height,
    warnings: input.svg_markup.includes('<svg') ? [] : ['The provided markup did not contain a detectable <svg> tag. The file was still rasterized as-is.'],
  };
}
