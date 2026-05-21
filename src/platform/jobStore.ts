/**
 * Job Store
 *
 * In-memory + JSON-persisted store for media generation jobs.
 * Keeps the last 500 jobs in memory; flushes to jobs-history.json on change.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AssetId, JobId, JobStatus, MediaJob, MediaJobRequest } from './types.js';

const MAX_HISTORY = 500;

interface JobStore {
  version: 1;
  jobs: MediaJob[];
}

export class JobRegistry {
  private storePath: string;
  private jobs = new Map<JobId, MediaJob>();
  private loaded = false;

  constructor(outputsRoot: string) {
    this.storePath = path.join(outputsRoot, 'jobs-history.json');
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const store = JSON.parse(raw) as JobStore;
      for (const job of store.jobs ?? []) {
        this.jobs.set(job.id, job);
      }
    } catch {
      // fresh start
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const all = [...this.jobs.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    const trimmed = all.slice(0, MAX_HISTORY);
    const store: JobStore = { version: 1, jobs: trimmed };
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(store, null, 2), 'utf8');
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async create(request: MediaJobRequest): Promise<MediaJob> {
    await this.init();
    const job: MediaJob = {
      id: randomUUID(),
      label: request.label ?? `${request.modality} — ${new Date().toLocaleTimeString()}`,
      project_id: request.project_id,
      modality: request.modality,
      status: 'queued',
      request,
      created_at: new Date().toISOString(),
      output_asset_ids: [],
      warnings: [],
    };
    this.jobs.set(job.id, job);
    await this.persist();
    return job;
  }

  async get(id: JobId): Promise<MediaJob | null> {
    await this.init();
    return this.jobs.get(id) ?? null;
  }

  async update(id: JobId, patch: Partial<MediaJob>): Promise<MediaJob | null> {
    await this.init();
    const job = this.jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch);
    await this.persist();
    return job;
  }

  async setStatus(id: JobId, status: JobStatus, extra?: Partial<MediaJob>): Promise<MediaJob | null> {
    const now = new Date().toISOString();
    const patch: Partial<MediaJob> = { status, ...extra };
    if (status === 'running' && !extra?.started_at) patch.started_at = now;
    if ((status === 'completed' || status === 'failed') && !extra?.completed_at) {
      patch.completed_at = now;
    }
    return this.update(id, patch);
  }

  async addOutputAsset(id: JobId, assetId: AssetId): Promise<void> {
    await this.init();
    const job = this.jobs.get(id);
    if (!job) return;
    job.output_asset_ids.push(assetId);
    await this.persist();
  }

  async list(opts: {
    project_id?: string;
    status?: JobStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ jobs: MediaJob[]; total: number }> {
    await this.init();
    let results = [...this.jobs.values()];

    if (opts.project_id) results = results.filter((j) => j.project_id === opts.project_id);
    if (opts.status) results = results.filter((j) => j.status === opts.status);

    results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const total = results.length;
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    return { jobs: results.slice(offset, offset + limit), total };
  }

  async activeCount(): Promise<number> {
    await this.init();
    return [...this.jobs.values()].filter(
      (j) => j.status === 'queued' || j.status === 'routing' || j.status === 'running',
    ).length;
  }
}
