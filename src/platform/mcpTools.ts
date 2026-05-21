/**
 * Platform MCP Tools
 *
 * Registers platform-level MCP tools on the McpServer so Claude can
 * interact with the hybrid media platform directly:
 *
 *   platform_status          — health + backend availability
 *   platform_submit_job      — submit a media generation job
 *   platform_get_job         — poll job status
 *   platform_search_assets   — search the asset library
 *   platform_get_asset       — get a single asset record
 *   platform_list_projects   — list projects
 *   platform_create_project  — create a project
 *   platform_route_preview   — preview routing decision without running
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PlatformServices } from './index.js';
import type { MediaJobRequest } from './types.js';

export function registerPlatformMcpTools(
  server: McpServer,
  services: PlatformServices,
): void {
  const { assetLibrary, jobRegistry, projectRegistry, mediaRouter } = services;

  // ── platform_status ────────────────────────────────────────────────────────
  server.tool(
    'platform_status',
    'Get hybrid media platform status: backend availability, asset counts, active jobs.',
    {},
    async () => {
      const [assetStats, activeJobs, { total: totalJobs }] = await Promise.all([
        assetLibrary.stats(),
        jobRegistry.activeCount(),
        jobRegistry.list({ limit: 1 }),
      ]);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            platform: 'hybrid-media-platform',
            version: '1.0.0',
            dashboard: 'http://127.0.0.1:3333',
            api: 'http://127.0.0.1:3333/api',
            assets: assetStats,
            jobs: { total: totalJobs, active: activeJobs },
          }, null, 2),
        }],
      };
    },
  );

  // ── platform_submit_job ────────────────────────────────────────────────────
  server.tool(
    'platform_submit_job',
    'Submit a media generation job to the hybrid platform. Supports all modalities: text-to-image, text-to-video, image-to-image, image-to-video, text-to-audio, image-to-3d, code-render, scene-graph, cinematic-treatment, and more. Backend is auto-selected unless specified.',
    {
      modality: z.enum([
        'text-to-image', 'text-to-video', 'image-to-image', 'image-to-video',
        'text-to-audio', 'image-to-3d', 'video-upscale', 'image-upscale',
        'inpaint', 'outpaint', 'remove-background',
        'code-render', 'scene-graph', 'cinematic-treatment',
      ]),
      prompt: z.string().min(1),
      label: z.string().optional(),
      backend: z.enum(['auto', 'code-svg', 'code-html-card', 'code-remotion', 'comfyui-local']).optional(),
      workflow_name: z.string().optional(),
      project_id: z.string().optional(),
      negative_prompt: z.string().optional(),
      seed: z.number().int().nonnegative().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      duration_seconds: z.number().positive().optional(),
      asset_tags: z.array(z.string()).optional(),
      extra_params: z.record(z.unknown()).optional(),
    },
    async (input) => {
      const request: MediaJobRequest = {
        modality: input.modality,
        prompt: input.prompt,
        label: input.label,
        backend: input.backend as any,
        workflow_name: input.workflow_name,
        project_id: input.project_id,
        negative_prompt: input.negative_prompt,
        seed: input.seed,
        width: input.width,
        height: input.height,
        duration_seconds: input.duration_seconds,
        asset_tags: input.asset_tags,
        extra_params: input.extra_params,
      };

      const job = await jobRegistry.create(request);

      // Fire-and-forget execution
      mediaRouter.execute(job.id, request).catch((e: unknown) => {
        console.error(`[platform] Job ${job.id} failed:`, e);
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            job_id: job.id,
            status: job.status,
            label: job.label,
            modality: job.modality,
            message: `Job submitted. Poll with platform_get_job tool using job_id: ${job.id}`,
            dashboard: `http://127.0.0.1:3333`,
          }, null, 2),
        }],
      };
    },
  );

  // ── platform_get_job ───────────────────────────────────────────────────────
  server.tool(
    'platform_get_job',
    'Get the current status and output assets of a platform media job.',
    {
      job_id: z.string().min(1),
    },
    async ({ job_id }) => {
      const job = await jobRegistry.get(job_id);
      if (!job) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Job '${job_id}' not found.` }) }],
          isError: true,
        };
      }

      // Attach asset summaries if completed
      let assets: unknown[] = [];
      if (job.output_asset_ids.length > 0) {
        const fetched = await Promise.all(
          job.output_asset_ids.map((id) => assetLibrary.getById(id)),
        );
        assets = fetched.filter(Boolean).map((a) => ({
          id: a!.id,
          kind: a!.kind,
          filename: a!.filename,
          path: a!.path,
          title: a!.title,
          width: a!.width,
          height: a!.height,
          file_size_bytes: a!.file_size_bytes,
        }));
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ...job, output_assets: assets }, null, 2),
        }],
      };
    },
  );

  // ── platform_search_assets ─────────────────────────────────────────────────
  server.tool(
    'platform_search_assets',
    'Search the platform asset library. Filter by kind, modality, backend, tags, or free-text search.',
    {
      search: z.string().optional(),
      kind: z.enum(['image', 'video', 'audio', 'svg', 'model-3d', 'document']).optional(),
      modality: z.string().optional(),
      backend: z.string().optional(),
      tags: z.array(z.string()).optional(),
      project_id: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (input) => {
      const { assets, total } = await assetLibrary.search({
        search: input.search,
        kind: input.kind as any,
        modality: input.modality as any,
        backend: input.backend as any,
        tags: input.tags,
        project_id: input.project_id,
        limit: input.limit ?? 20,
        offset: input.offset ?? 0,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ total, returned: assets.length, assets }, null, 2),
        }],
      };
    },
  );

  // ── platform_get_asset ─────────────────────────────────────────────────────
  server.tool(
    'platform_get_asset',
    'Get full metadata for a single platform asset by ID.',
    {
      asset_id: z.string().min(1),
    },
    async ({ asset_id }) => {
      const asset = await assetLibrary.getById(asset_id);
      if (!asset) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Asset '${asset_id}' not found.` }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(asset, null, 2) }],
      };
    },
  );

  // ── platform_list_projects ─────────────────────────────────────────────────
  server.tool(
    'platform_list_projects',
    'List all media projects on the platform.',
    {},
    async () => {
      const projects = await projectRegistry.list();
      return {
        content: [{ type: 'text', text: JSON.stringify({ projects, total: projects.length }, null, 2) }],
      };
    },
  );

  // ── platform_create_project ────────────────────────────────────────────────
  server.tool(
    'platform_create_project',
    'Create a new media project to group jobs and assets.',
    {
      name: z.string().min(1),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ name, description, tags }) => {
      const project = await projectRegistry.create({ name, description, tags });
      return {
        content: [{ type: 'text', text: JSON.stringify(project, null, 2) }],
      };
    },
  );

  // ── platform_route_preview ─────────────────────────────────────────────────
  server.tool(
    'platform_route_preview',
    'Preview the routing decision for a media request without actually running it. Shows which backend and workflow would be selected.',
    {
      modality: z.string().min(1),
      prompt: z.string().min(1),
      backend: z.string().optional(),
      workflow_name: z.string().optional(),
    },
    async ({ modality, prompt, backend, workflow_name }) => {
      const decision = await mediaRouter.route({
        modality: modality as any,
        prompt,
        backend: backend as any,
        workflow_name,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }],
      };
    },
  );

  // ── platform_list_jobs ─────────────────────────────────────────────────────
  server.tool(
    'platform_list_jobs',
    'List recent platform media jobs with their status.',
    {
      status: z.enum(['queued', 'routing', 'running', 'completed', 'failed', 'cancelled']).optional(),
      project_id: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    async ({ status, project_id, limit }) => {
      const { jobs, total } = await jobRegistry.list({
        status: status as any,
        project_id,
        limit: limit ?? 20,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ total, returned: jobs.length, jobs }, null, 2) }],
      };
    },
  );
}
