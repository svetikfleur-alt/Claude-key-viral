import fs from 'node:fs/promises';
import path from 'node:path';

export function assertInside(base: string, target: string): void {
  const baseAbs = path.resolve(base);
  const targetAbs = path.resolve(target);
  if (!(targetAbs === baseAbs || targetAbs.startsWith(baseAbs + path.sep))) {
    throw new Error(`Path safety error. Cause: resolved path escapes '${baseAbs}'. Suggested fix: keep file operations inside configured directories.`);
  }
}

export function sanitizeFilename(name: string): string {
  const normalized = name.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Invalid filename. Cause: '${name}' contains unsupported characters. Suggested fix: use letters, numbers, dot, dash, or underscore only.`);
  }
  return normalized;
}

export async function safeCopyFileIntoDir(opts: {
  sourcePath: string;
  destDir: string;
  destFilename: string;
}): Promise<string> {
  const destDirAbs = path.resolve(opts.destDir);
  const destFilename = sanitizeFilename(opts.destFilename);
  const destPath = path.resolve(destDirAbs, destFilename);
  assertInside(destDirAbs, destPath);
  await fs.mkdir(destDirAbs, { recursive: true });
  await fs.copyFile(opts.sourcePath, destPath);
  return destPath;
}

