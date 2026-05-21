import fs from 'node:fs/promises';
import path from 'node:path';
import type { OutputIndexEntry, ResolvedConfig, RunLogEntry } from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

export async function ensureLogFiles(config: ResolvedConfig): Promise<void> {
  await fs.mkdir(config.logs_dir_abs, { recursive: true });
  try {
    await fs.access(config.outputs_index_file_abs);
  } catch {
    await fs.writeFile(config.outputs_index_file_abs, '[]\n', 'utf8');
  }
}

export function buildRunLogPath(config: ResolvedConfig, runId: string): string {
  return path.join(config.logs_dir_abs, `${runId}.json`);
}

export async function writeRunLog(logFile: string, entry: RunLogEntry): Promise<void> {
  await fs.writeFile(logFile, `${JSON.stringify({ ...entry, timestamp: entry.timestamp ?? nowIso() }, null, 2)}\n`, 'utf8');
}

export async function appendOutputIndex(config: ResolvedConfig, entry: OutputIndexEntry): Promise<void> {
  let existing: OutputIndexEntry[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(config.outputs_index_file_abs, 'utf8')) as OutputIndexEntry[];
    existing = Array.isArray(parsed) ? parsed : [];
  } catch {
    existing = [];
  }
  existing.unshift(entry);
  await fs.writeFile(config.outputs_index_file_abs, `${JSON.stringify(existing.slice(0, 200), null, 2)}\n`, 'utf8');
}

export async function readOutputIndex(config: ResolvedConfig): Promise<OutputIndexEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(config.outputs_index_file_abs, 'utf8')) as OutputIndexEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
