/**
 * Asset Library
 *
 * Persistent catalog of all generated media assets. Backed by a JSON store
 * (assets-library.json) in the outputs directory. Provides CRUD, search,
 * and file-existence validation.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AssetId,
  AssetKind,
  AssetMimeType,
  AssetSearchQuery,
  JobId,
  MediaAsset,
  ProjectId,
  RendererBackend,
  MediaModality,
} from './types.js';

// ─── Mime / Kind helpers ─────────────────────────────────────────────────────

const EXT_MIME: Record<string, AssetMimeType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.md': 'text/markdown',
};

const MIME_KIND: Record<string, AssetKind> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'svg',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'model/gltf-binary': 'model-3d',
  'application/json': 'document',
  'text/markdown': 'document',
};

function mimeFromPath(filePath: string): AssetMimeType {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_MIME[ext] ?? 'application/json';
}

function kindFromMime(mime: AssetMimeType): AssetKind {
  return MIME_KIND[mime] ?? 'document';
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface LibraryStore {
  version: 1;
  assets: MediaAsset[];
}

export class AssetLibrary {
  private storePath: string;
  private projectRoot: string;
  private store: LibraryStore | null = null;

  constructor(outputsRoot: string, projectRoot: string) {
    this.storePath = path.join(outputsRoot, 'assets-library.json');
    this.projectRoot = projectRoot;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private async load(): Promise<LibraryStore> {
    if (this.store) return this.store;
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      this.store = JSON.parse(raw) as LibraryStore;
    } catch {
      this.store = { version: 1, assets: [] };
    }
    return this.store;
  }

  private async save(): Promise<void> {
    if (!this.store) return;
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2), 'utf8');
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * Register a new asset. Automatically derives mime type and kind from the
   * file extension if not provided.
   */
  async register(params: {
    filePath: string;
    jobId?: JobId;
    projectId?: ProjectId;
    title?: string;
    tags?: string[];
    width?: number;
    height?: number;
    durationSeconds?: number;
    modality?: MediaModality;
    backend?: RendererBackend;
    prompt?: string;
    seed?: number;
  }): Promise<MediaAsset> {
    const store = await this.load();

    const mime = mimeFromPath(params.filePath);
    const kind = kindFromMime(mime);
    const filename = path.basename(params.filePath);
    const relativePath = path.relative(this.projectRoot, params.filePath).replace(/\\/g, '/');

    let fileSizeBytes: number | undefined;
    try {
      const stat = await fs.stat(params.filePath);
      fileSizeBytes = stat.size;
    } catch {
      // file may not exist yet (registered before write completes)
    }

    const asset: MediaAsset = {
      id: randomUUID(),
      job_id: params.jobId,
      project_id: params.projectId,
      kind,
      mime_type: mime,
      filename,
      path: params.filePath,
      relative_path: relativePath,
      title: params.title ?? filename,
      tags: params.tags ?? [],
      width: params.width,
      height: params.height,
      duration_seconds: params.durationSeconds,
      file_size_bytes: fileSizeBytes,
      modality: params.modality,
      backend: params.backend,
      prompt: params.prompt,
      seed: params.seed,
      created_at: new Date().toISOString(),
      exists: fileSizeBytes !== undefined,
    };

    store.assets.push(asset);
    await this.save();
    return asset;
  }

  async getById(id: AssetId): Promise<MediaAsset | null> {
    const store = await this.load();
    return store.assets.find((a) => a.id === id) ?? null;
  }

  async updateTags(id: AssetId, tags: string[]): Promise<MediaAsset | null> {
    const store = await this.load();
    const asset = store.assets.find((a) => a.id === id);
    if (!asset) return null;
    asset.tags = tags;
    await this.save();
    return asset;
  }

  async delete(id: AssetId): Promise<boolean> {
    const store = await this.load();
    const idx = store.assets.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    store.assets.splice(idx, 1);
    await this.save();
    return true;
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  async search(query: AssetSearchQuery = {}): Promise<{ assets: MediaAsset[]; total: number }> {
    const store = await this.load();
    let results = store.assets.slice();

    if (query.project_id) {
      results = results.filter((a) => a.project_id === query.project_id);
    }
    if (query.job_id) {
      results = results.filter((a) => a.job_id === query.job_id);
    }
    if (query.kind) {
      results = results.filter((a) => a.kind === query.kind);
    }
    if (query.modality) {
      results = results.filter((a) => a.modality === query.modality);
    }
    if (query.backend) {
      results = results.filter((a) => a.backend === query.backend);
    }
    if (query.tags && query.tags.length > 0) {
      results = results.filter((a) => query.tags!.every((t) => a.tags.includes(t)));
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      results = results.filter(
        (a) =>
          a.title?.toLowerCase().includes(q) ||
          a.filename.toLowerCase().includes(q) ||
          a.prompt?.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Sort
    const sort = query.sort ?? 'created_at_desc';
    if (sort === 'created_at_desc') {
      results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (sort === 'created_at_asc') {
      results.sort((a, b) => a.created_at.localeCompare(b.created_at));
    } else if (sort === 'file_size_desc') {
      results.sort((a, b) => (b.file_size_bytes ?? 0) - (a.file_size_bytes ?? 0));
    }

    const total = results.length;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    return { assets: results.slice(offset, offset + limit), total };
  }

  /** Refresh the `exists` flag for all assets by checking the filesystem. */
  async validateExistence(): Promise<{ checked: number; missing: number }> {
    const store = await this.load();
    let missing = 0;
    for (const asset of store.assets) {
      try {
        await fs.access(asset.path);
        asset.exists = true;
      } catch {
        asset.exists = false;
        missing++;
      }
    }
    await this.save();
    return { checked: store.assets.length, missing };
  }

  async stats(): Promise<{
    total: number;
    by_kind: Record<string, number>;
    by_modality: Record<string, number>;
    by_backend: Record<string, number>;
  }> {
    const store = await this.load();
    const by_kind: Record<string, number> = {};
    const by_modality: Record<string, number> = {};
    const by_backend: Record<string, number> = {};

    for (const a of store.assets) {
      by_kind[a.kind] = (by_kind[a.kind] ?? 0) + 1;
      if (a.modality) by_modality[a.modality] = (by_modality[a.modality] ?? 0) + 1;
      if (a.backend) by_backend[a.backend] = (by_backend[a.backend] ?? 0) + 1;
    }

    return { total: store.assets.length, by_kind, by_modality, by_backend };
  }
}
