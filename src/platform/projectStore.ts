/**
 * Project Store
 *
 * Simple JSON-backed store for media projects. Projects group jobs and assets
 * under a named context.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CreateProjectInput, Project, ProjectId } from './types.js';

interface ProjectStore {
  version: 1;
  projects: Project[];
}

export class ProjectRegistry {
  private storePath: string;
  private store: ProjectStore | null = null;

  constructor(outputsRoot: string) {
    this.storePath = path.join(outputsRoot, 'projects.json');
  }

  private async load(): Promise<ProjectStore> {
    if (this.store) return this.store;
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      this.store = JSON.parse(raw) as ProjectStore;
    } catch {
      this.store = { version: 1, projects: [] };
    }
    return this.store;
  }

  private async save(): Promise<void> {
    if (!this.store) return;
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2), 'utf8');
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const store = await this.load();
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      tags: input.tags ?? [],
      created_at: now,
      updated_at: now,
    };
    store.projects.push(project);
    await this.save();
    return project;
  }

  async getById(id: ProjectId): Promise<Project | null> {
    const store = await this.load();
    return store.projects.find((p) => p.id === id) ?? null;
  }

  async list(): Promise<Project[]> {
    const store = await this.load();
    return [...store.projects].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async update(id: ProjectId, patch: Partial<Pick<Project, 'name' | 'description' | 'tags'>>): Promise<Project | null> {
    const store = await this.load();
    const project = store.projects.find((p) => p.id === id);
    if (!project) return null;
    Object.assign(project, patch, { updated_at: new Date().toISOString() });
    await this.save();
    return project;
  }

  async delete(id: ProjectId): Promise<boolean> {
    const store = await this.load();
    const idx = store.projects.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    store.projects.splice(idx, 1);
    await this.save();
    return true;
  }
}
