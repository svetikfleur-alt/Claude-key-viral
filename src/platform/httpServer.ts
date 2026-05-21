/**
 * Platform HTTP Server
 *
 * A lightweight HTTP API server that runs alongside the MCP server.
 * Exposes the hybrid media platform over REST so the web dashboard and
 * external tools can interact with it without going through MCP.
 *
 * Endpoints:
 *
 *   GET  /api/status                    Platform health + backend status
 *   GET  /api/projects                  List projects
 *   POST /api/projects                  Create project
 *   GET  /api/projects/:id              Get project
 *   PUT  /api/projects/:id              Update project
 *   DELETE /api/projects/:id            Delete project
 *
 *   GET  /api/jobs                      List jobs (query: project_id, status, limit, offset)
 *   POST /api/jobs                      Submit a new media job
 *   GET  /api/jobs/:id                  Get job status
 *   DELETE /api/jobs/:id/cancel         Cancel a queued job
 *
 *   GET  /api/assets                    Search assets (query: project_id, kind, modality, search, tags, limit, offset)
 *   GET  /api/assets/:id                Get asset metadata
 *   GET  /api/assets/:id/file           Serve the asset file
 *   PUT  /api/assets/:id/tags           Update asset tags
 *   DELETE /api/assets/:id              Delete asset record (does not delete file)
 *   POST /api/assets/validate           Re-check file existence for all assets
 *
 *   GET  /api/workflows                 List configured ComfyUI workflows
 *   GET  /api/backends                  List backend availability
 *
 *   GET  /                              Serve the web dashboard (static files)
 *   GET  /assets/*                      Serve dashboard static assets
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import type { ResolvedConfig } from '../types.js';
import type { AssetLibrary } from './assetLibrary.js';
import type { JobRegistry } from './jobStore.js';
import type { ProjectRegistry } from './projectStore.js';
import type { MediaRouter } from './mediaRouter.js';
import { ComfyUiClient } from '../comfyuiClient.js';
import { listConfiguredWorkflows } from '../workflowStore.js';
import { ok, err } from './types.js';
import type { MediaJobRequest, AssetSearchQuery } from './types.js';

const PLATFORM_VERSION = '1.0.0';
const startedAt = Date.now();

// ─── MIME types for static file serving ──────────────────────────────────────

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// ─── Request helpers ──────────────────────────────────────────────────────────

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

function sendOk<T>(res: http.ServerResponse, data: T, status = 200): void {
  send(res, status, ok(data));
}

function sendErr(res: http.ServerResponse, message: string, status = 400, details?: string): void {
  send(res, status, err(message, details));
}

function parseQuery(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { out[k] = v; });
  return out;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export interface HttpServerDeps {
  config: ResolvedConfig;
  assetLibrary: AssetLibrary;
  jobRegistry: JobRegistry;
  projectRegistry: ProjectRegistry;
  mediaRouter: MediaRouter;
  dashboardDir: string;   // path to built dashboard static files
  projectRoot: string;
}

export function createHttpServer(deps: HttpServerDeps): http.Server {
  const { config, assetLibrary, jobRegistry, projectRegistry, mediaRouter, dashboardDir, projectRoot } = deps;
  const comfyClient = new ComfyUiClient(config);

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url ?? '/';
    const baseUrl = `http://localhost${rawUrl}`;
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      sendErr(res, 'Bad request URL', 400);
      return;
    }

    const method = req.method?.toUpperCase() ?? 'GET';
    const pathname = url.pathname;

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    try {
      // ── Status ──────────────────────────────────────────────────────────────
      if (pathname === '/api/status' && method === 'GET') {
        const [health, assetStats, activeJobs] = await Promise.all([
          comfyClient.healthCheck(),
          assetLibrary.stats(),
          jobRegistry.activeCount(),
        ]);
        const { total: totalJobs } = await jobRegistry.list({ limit: 1 });
        sendOk(res, {
          version: PLATFORM_VERSION,
          backends: [
            { backend: 'code-svg', available: true, message: 'Always available' },
            { backend: 'code-html-card', available: true, message: 'Always available' },
            { backend: 'code-remotion', available: true, message: 'Always available' },
            {
              backend: 'comfyui-local',
              available: health.reachable,
              url: health.comfyui_url,
              message: health.message,
            },
          ],
          total_assets: assetStats.total,
          total_jobs: totalJobs,
          active_jobs: activeJobs,
          uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
        });
        return;
      }

      // ── Projects ────────────────────────────────────────────────────────────
      if (pathname === '/api/projects') {
        if (method === 'GET') {
          const projects = await projectRegistry.list();
          sendOk(res, projects);
          return;
        }
        if (method === 'POST') {
          const body = await parseBody(req) as Record<string, unknown>;
          if (!body.name || typeof body.name !== 'string') {
            sendErr(res, 'name is required');
            return;
          }
          const project = await projectRegistry.create({
            name: body.name,
            description: typeof body.description === 'string' ? body.description : undefined,
            tags: Array.isArray(body.tags) ? body.tags as string[] : [],
          });
          sendOk(res, project, 201);
          return;
        }
      }

      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch) {
        const id = projectMatch[1];
        if (method === 'GET') {
          const project = await projectRegistry.getById(id);
          if (!project) { sendErr(res, 'Project not found', 404); return; }
          sendOk(res, project);
          return;
        }
        if (method === 'PUT') {
          const body = await parseBody(req) as Record<string, unknown>;
          const updated = await projectRegistry.update(id, {
            name: typeof body.name === 'string' ? body.name : undefined,
            description: typeof body.description === 'string' ? body.description : undefined,
            tags: Array.isArray(body.tags) ? body.tags as string[] : undefined,
          });
          if (!updated) { sendErr(res, 'Project not found', 404); return; }
          sendOk(res, updated);
          return;
        }
        if (method === 'DELETE') {
          const deleted = await projectRegistry.delete(id);
          if (!deleted) { sendErr(res, 'Project not found', 404); return; }
          sendOk(res, { deleted: true });
          return;
        }
      }

      // ── Jobs ────────────────────────────────────────────────────────────────
      if (pathname === '/api/jobs') {
        if (method === 'GET') {
          const q = parseQuery(url);
          const { jobs, total } = await jobRegistry.list({
            project_id: q.project_id,
            status: q.status as any,
            limit: q.limit ? parseInt(q.limit, 10) : 50,
            offset: q.offset ? parseInt(q.offset, 10) : 0,
          });
          sendOk(res, { jobs, total });
          return;
        }
        if (method === 'POST') {
          const body = await parseBody(req) as MediaJobRequest;
          if (!body.modality || !body.prompt) {
            sendErr(res, 'modality and prompt are required');
            return;
          }
          // Create job record
          const job = await jobRegistry.create(body);
          // Execute asynchronously — don't await so we return immediately
          mediaRouter.execute(job.id, body).catch((e) => {
            console.error(`[platform] Job ${job.id} failed:`, e);
          });
          sendOk(res, job, 202);
          return;
        }
      }

      const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (jobMatch) {
        const id = jobMatch[1];
        if (method === 'GET') {
          const job = await jobRegistry.get(id);
          if (!job) { sendErr(res, 'Job not found', 404); return; }
          sendOk(res, job);
          return;
        }
      }

      const jobCancelMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
      if (jobCancelMatch && method === 'DELETE') {
        const id = jobCancelMatch[1];
        const job = await jobRegistry.get(id);
        if (!job) { sendErr(res, 'Job not found', 404); return; }
        if (job.status !== 'queued') {
          sendErr(res, `Cannot cancel job in status '${job.status}'`);
          return;
        }
        await jobRegistry.setStatus(id, 'cancelled');
        sendOk(res, { cancelled: true });
        return;
      }

      // ── Assets ──────────────────────────────────────────────────────────────
      if (pathname === '/api/assets') {
        if (method === 'GET') {
          const q = parseQuery(url);
          const query: AssetSearchQuery = {
            project_id: q.project_id,
            job_id: q.job_id,
            kind: q.kind as any,
            modality: q.modality as any,
            backend: q.backend as any,
            tags: q.tags ? q.tags.split(',') : undefined,
            search: q.search,
            limit: q.limit ? parseInt(q.limit, 10) : 50,
            offset: q.offset ? parseInt(q.offset, 10) : 0,
            sort: q.sort as any,
          };
          const result = await assetLibrary.search(query);
          sendOk(res, result);
          return;
        }
      }

      if (pathname === '/api/assets/validate' && method === 'POST') {
        const result = await assetLibrary.validateExistence();
        sendOk(res, result);
        return;
      }

      const assetFileMatch = pathname.match(/^\/api\/assets\/([^/]+)\/file$/);
      if (assetFileMatch && method === 'GET') {
        const id = assetFileMatch[1];
        const asset = await assetLibrary.getById(id);
        if (!asset) { sendErr(res, 'Asset not found', 404); return; }
        try {
          const data = await fs.readFile(asset.path);
          const ext = path.extname(asset.filename).toLowerCase();
          const mime = STATIC_MIME[ext] ?? 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': data.length,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
          });
          res.end(data);
        } catch {
          sendErr(res, 'Asset file not found on disk', 404);
        }
        return;
      }

      const assetTagsMatch = pathname.match(/^\/api\/assets\/([^/]+)\/tags$/);
      if (assetTagsMatch && method === 'PUT') {
        const id = assetTagsMatch[1];
        const body = await parseBody(req) as Record<string, unknown>;
        const tags = Array.isArray(body.tags) ? body.tags as string[] : [];
        const updated = await assetLibrary.updateTags(id, tags);
        if (!updated) { sendErr(res, 'Asset not found', 404); return; }
        sendOk(res, updated);
        return;
      }

      const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
      if (assetMatch) {
        const id = assetMatch[1];
        if (method === 'GET') {
          const asset = await assetLibrary.getById(id);
          if (!asset) { sendErr(res, 'Asset not found', 404); return; }
          sendOk(res, asset);
          return;
        }
        if (method === 'DELETE') {
          const deleted = await assetLibrary.delete(id);
          if (!deleted) { sendErr(res, 'Asset not found', 404); return; }
          sendOk(res, { deleted: true });
          return;
        }
      }

      // ── Workflows ────────────────────────────────────────────────────────────
      if (pathname === '/api/workflows' && method === 'GET') {
        const workflows = await listConfiguredWorkflows(config);
        sendOk(res, workflows);
        return;
      }

      // ── Backends ─────────────────────────────────────────────────────────────
      if (pathname === '/api/backends' && method === 'GET') {
        const health = await comfyClient.healthCheck();
        sendOk(res, [
          { backend: 'code-svg', available: true, message: 'Always available — no AI needed' },
          { backend: 'code-html-card', available: true, message: 'Always available — no AI needed' },
          { backend: 'code-remotion', available: true, message: 'Always available — no AI needed' },
          {
            backend: 'comfyui-local',
            available: health.reachable,
            url: health.comfyui_url,
            message: health.message,
          },
        ]);
        return;
      }

      // ── Serve generated media files ──────────────────────────────────────────
      if (pathname.startsWith('/media/') && method === 'GET') {
        const relativePart = pathname.slice('/media/'.length);
        const filePath = path.join(config.generated_media_dir_abs, relativePart);
        // Security: ensure path stays within generated_media_dir
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(path.resolve(config.generated_media_dir_abs))) {
          sendErr(res, 'Forbidden', 403);
          return;
        }
        try {
          const data = await fs.readFile(resolved);
          const ext = path.extname(resolved).toLowerCase();
          const mime = STATIC_MIME[ext] ?? 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': data.length,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
          });
          res.end(data);
        } catch {
          sendErr(res, 'File not found', 404);
        }
        return;
      }

      // ── Dashboard static files ───────────────────────────────────────────────
      if (method === 'GET') {
        let filePath: string;
        if (pathname === '/' || pathname === '/index.html') {
          filePath = path.join(dashboardDir, 'index.html');
        } else {
          filePath = path.join(dashboardDir, pathname);
        }

        // Security: ensure path stays within dashboardDir
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(path.resolve(dashboardDir))) {
          sendErr(res, 'Forbidden', 403);
          return;
        }

        try {
          const data = await fs.readFile(resolved);
          const ext = path.extname(resolved).toLowerCase();
          const mime = STATIC_MIME[ext] ?? 'text/plain';
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': data.length,
            'Access-Control-Allow-Origin': '*',
          });
          res.end(data);
        } catch {
          // SPA fallback — serve index.html for unknown routes
          try {
            const indexData = await fs.readFile(path.join(dashboardDir, 'index.html'));
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(indexData);
          } catch {
            sendErr(res, 'Not found', 404);
          }
        }
        return;
      }

      sendErr(res, 'Not found', 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[platform http]', message);
      sendErr(res, 'Internal server error', 500, message);
    }
  });

  return server;
}

export function startHttpServer(
  deps: HttpServerDeps,
  port = 3333,
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = createHttpServer(deps);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      console.log(`[platform] HTTP server listening on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}
