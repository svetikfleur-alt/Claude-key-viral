/**
 * Media Router
 *
 * Decides which backend to use for a given media job request, then executes
 * the job end-to-end. Supports:
 *
 *   code-svg        → sceneDslRenderer / svgRenderer
 *   code-html-card  → htmlCardRenderer
 *   code-remotion   → remotionRenderer
 *   comfyui-local   → ComfyUiClient + workflowStore/patcher
 *   auto            → picks the best available backend
 *
 * The router is intentionally stateless — it receives all dependencies via
 * constructor injection so it can be used from both the HTTP server and the
 * MCP server.
 */

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ResolvedConfig } from '../types.js';
import type {
  AssetId,
  JobId,
  MediaJobRequest,
  RendererBackend,
  RoutingDecision,
} from './types.js';
import type { AssetLibrary } from './assetLibrary.js';
import type { JobRegistry } from './jobStore.js';
import { ComfyUiClient } from '../comfyuiClient.js';
import { listConfiguredWorkflows, loadWorkflow } from '../workflowStore.js';
import { patchWorkflowForRun } from '../workflowPatcher.js';
import { detectOutputsFromHistory } from '../outputDetector.js';
import { renderHtmlCard } from '../codegen/htmlCardRenderer.js';
import { renderRemotionVideo } from '../codegen/remotionRenderer.js';
import { renderSvgScene } from '../codegen/sceneDslRenderer.js';
import { renderCodeImage } from '../codegen/svgRenderer.js';
import type {
  HtmlCardInput,
  RemotionVideoInput,
  SvgSceneRenderInput,
  SvgTemplateInput,
} from '../types.js';

// ─── Modality → default backend mapping ──────────────────────────────────────

const MODALITY_DEFAULT_BACKEND: Record<string, RendererBackend> = {
  'code-render': 'code-html-card',
  'scene-graph': 'code-svg',
  'cinematic-treatment': 'code-remotion',
  'text-to-image': 'comfyui-local',
  'text-to-video': 'comfyui-local',
  'image-to-image': 'comfyui-local',
  'image-to-video': 'comfyui-local',
  'text-to-audio': 'comfyui-local',
  'image-to-3d': 'comfyui-local',
  'video-upscale': 'comfyui-local',
  'image-upscale': 'comfyui-local',
  'inpaint': 'comfyui-local',
  'outpaint': 'comfyui-local',
  'remove-background': 'comfyui-local',
};

// ─── Modality → ComfyUI workflow name hints ───────────────────────────────────

const MODALITY_WORKFLOW_HINTS: Record<string, string[]> = {
  'text-to-image': ['basic-image', 'qwen-image-edit-pro'],
  'image-to-image': ['qwen-image-edit-pro'],
  'image-to-video': ['wan-i2v-pro'],
  'text-to-video': ['wan-i2v-pro'],
};

export interface RouterDeps {
  config: ResolvedConfig;
  assetLibrary: AssetLibrary;
  jobRegistry: JobRegistry;
  projectRoot: string;
}

export class MediaRouter {
  private client: ComfyUiClient;

  constructor(private deps: RouterDeps) {
    this.client = new ComfyUiClient(deps.config);
  }

  // ── Routing decision ───────────────────────────────────────────────────────

  async route(request: MediaJobRequest): Promise<RoutingDecision> {
    const preferred = request.backend ?? 'auto';

    // Explicit workflow name → always use ComfyUI
    if (request.workflow_name) {
      return {
        backend: 'comfyui-local',
        workflow_name: request.workflow_name,
        reason: `Explicit workflow_name '${request.workflow_name}' specified.`,
        fallback_available: true,
      };
    }

    // Explicit backend requested
    if (preferred !== 'auto') {
      return {
        backend: preferred,
        reason: `Explicit backend '${preferred}' requested.`,
        fallback_available: preferred !== 'code-svg' && preferred !== 'code-html-card',
      };
    }

    // Auto-routing: code-first modalities never need ComfyUI
    const codeFirst: string[] = ['code-render', 'scene-graph', 'cinematic-treatment'];
    if (codeFirst.includes(request.modality)) {
      const backend = MODALITY_DEFAULT_BACKEND[request.modality] ?? 'code-svg';
      return {
        backend,
        reason: `Modality '${request.modality}' is code-first — no AI backend needed.`,
        fallback_available: false,
      };
    }

    // Check if ComfyUI is reachable
    const health = await this.client.healthCheck();
    if (health.reachable) {
      const hints = MODALITY_WORKFLOW_HINTS[request.modality] ?? [];
      const configured = await listConfiguredWorkflows(this.deps.config);
      const configuredNames = configured.map((w) => w.workflow_name);
      const match = hints.find((h) => configuredNames.includes(h));
      return {
        backend: 'comfyui-local',
        workflow_name: match,
        reason: match
          ? `ComfyUI reachable; matched workflow '${match}' for modality '${request.modality}'.`
          : `ComfyUI reachable; no pre-configured workflow for '${request.modality}' — will use first available.`,
        fallback_available: true,
      };
    }

    // ComfyUI not reachable — fall back to code renderers where possible
    const fallbackBackend = this.codeFallback(request.modality);
    return {
      backend: fallbackBackend,
      reason: `ComfyUI not reachable. Falling back to '${fallbackBackend}' for modality '${request.modality}'.`,
      fallback_available: false,
    };
  }

  private codeFallback(modality: string): RendererBackend {
    // For generative modalities we can at least render a placeholder card
    return 'code-html-card';
  }

  // ── Job execution ──────────────────────────────────────────────────────────

  async execute(jobId: JobId, request: MediaJobRequest): Promise<AssetId[]> {
    const { jobRegistry, assetLibrary, config, projectRoot } = this.deps;

    await jobRegistry.setStatus(jobId, 'routing');
    const decision = await this.route(request);
    await jobRegistry.update(jobId, {
      backend_used: decision.backend,
      workflow_name: decision.workflow_name,
    });

    await jobRegistry.setStatus(jobId, 'running');

    try {
      let assetIds: AssetId[];

      switch (decision.backend) {
        case 'code-html-card':
          assetIds = await this.runHtmlCard(jobId, request, decision);
          break;
        case 'code-svg':
          assetIds = await this.runSvgScene(jobId, request, decision);
          break;
        case 'code-remotion':
          assetIds = await this.runRemotion(jobId, request, decision);
          break;
        case 'comfyui-local':
          assetIds = await this.runComfyUI(jobId, request, decision);
          break;
        default:
          assetIds = await this.runHtmlCard(jobId, request, decision);
      }

      const started = (await jobRegistry.get(jobId))?.started_at;
      const durationSeconds = started
        ? Number(((Date.now() - new Date(started).getTime()) / 1000).toFixed(3))
        : undefined;

      await jobRegistry.setStatus(jobId, 'completed', {
        output_asset_ids: assetIds,
        duration_seconds: durationSeconds,
      });

      return assetIds;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await jobRegistry.setStatus(jobId, 'failed', { error: message });
      throw error;
    }
  }

  // ── Backend runners ────────────────────────────────────────────────────────

  private async runHtmlCard(
    jobId: JobId,
    request: MediaJobRequest,
    _decision: RoutingDecision,
  ): Promise<AssetId[]> {
    const { assetLibrary, config } = this.deps;

    const input: HtmlCardInput = {
      template: 'feature_overview_card',
      title: request.label ?? request.prompt.slice(0, 60),
      subtitle: request.prompt,
      eyebrow: request.modality,
      width: request.width ?? 1200,
      height: request.height ?? 630,
      output_name: `job-${jobId.slice(0, 8)}`,
    };

    const result = await renderHtmlCard(input, config.generated_media_dir_abs);

    const ids: AssetId[] = [];
    for (const filePath of [result.png_path, result.svg_path]) {
      const asset = await assetLibrary.register({
        filePath,
        jobId,
        projectId: request.project_id,
        title: input.title,
        tags: request.asset_tags ?? [],
        width: result.width,
        height: result.height,
        modality: request.modality,
        backend: 'code-html-card',
        prompt: request.prompt,
      });
      ids.push(asset.id);
    }
    return ids;
  }

  private async runSvgScene(
    jobId: JobId,
    request: MediaJobRequest,
    _decision: RoutingDecision,
  ): Promise<AssetId[]> {
    const { assetLibrary, config } = this.deps;

    // Build a minimal scene from the prompt text
    const sceneInput: SvgSceneRenderInput = {
      scene: {
        width: request.width ?? 1200,
        height: request.height ?? 630,
        background: '#0d172b',
        nodes: [
          {
            kind: 'rect',
            x: 0, y: 0,
            width: request.width ?? 1200,
            height: request.height ?? 630,
            fill: 'url(#bg-grad)',
          },
          {
            kind: 'text',
            x: 60, y: 120,
            width: (request.width ?? 1200) - 120,
            text: request.label ?? request.prompt.slice(0, 80),
            font_size: 48,
            font_weight: 700,
            fill: '#f8fafc',
            align: 'left',
          },
          {
            kind: 'text',
            x: 60, y: 200,
            width: (request.width ?? 1200) - 120,
            text: request.prompt,
            font_size: 22,
            fill: '#bfd0e4',
            align: 'left',
            line_height: 1.5,
          },
        ],
        defs: {
          gradients: [
            {
              id: 'bg-grad',
              type: 'linear',
              x1: '0%', y1: '0%', x2: '100%', y2: '100%',
              stops: [
                { offset: '0%', color: '#0d172b' },
                { offset: '100%', color: '#122236' },
              ],
            },
          ],
        },
      },
      output_name: `job-${jobId.slice(0, 8)}-scene`,
      rasterize_png: true,
    };

    const result = await renderSvgScene(sceneInput, config.generated_media_dir_abs);
    const ids: AssetId[] = [];

    for (const filePath of [result.svg_path, result.png_path].filter(Boolean) as string[]) {
      const asset = await assetLibrary.register({
        filePath,
        jobId,
        projectId: request.project_id,
        title: request.label ?? request.prompt.slice(0, 60),
        tags: request.asset_tags ?? [],
        width: result.width,
        height: result.height,
        modality: request.modality,
        backend: 'code-svg',
        prompt: request.prompt,
      });
      ids.push(asset.id);
    }
    return ids;
  }

  private async runRemotion(
    jobId: JobId,
    request: MediaJobRequest,
    _decision: RoutingDecision,
  ): Promise<AssetId[]> {
    const { assetLibrary, config } = this.deps;

    const input: RemotionVideoInput = {
      title: request.label ?? request.prompt.slice(0, 60),
      subtitle: request.prompt,
      theme: 'slate',
      visual_style: 'presentation',
      duration_seconds: request.duration_seconds ?? 8,
      width: request.width ?? 1920,
      height: request.height ?? 1080,
      fps: 30,
      output_name: `job-${jobId.slice(0, 8)}-video`,
    };

    const result = await renderRemotionVideo(input, config.generated_media_dir_abs);
    const asset = await assetLibrary.register({
      filePath: result.file_path,
      jobId,
      projectId: request.project_id,
      title: input.title,
      tags: request.asset_tags ?? [],
      width: input.width,
      height: input.height,
      durationSeconds: input.duration_seconds,
      modality: request.modality,
      backend: 'code-remotion',
      prompt: request.prompt,
    });
    return [asset.id];
  }

  private async runComfyUI(
    jobId: JobId,
    request: MediaJobRequest,
    decision: RoutingDecision,
  ): Promise<AssetId[]> {
    const { assetLibrary, config, jobRegistry } = this.deps;

    // Resolve workflow name
    let workflowName = decision.workflow_name;
    if (!workflowName) {
      const configured = await listConfiguredWorkflows(config);
      if (configured.length === 0) {
        throw new Error('No ComfyUI workflows configured. Add a workflow to config.json.');
      }
      workflowName = configured[0].workflow_name;
    }

    const loaded = await loadWorkflow(config, workflowName);
    const runInput = {
      workflow_name: workflowName,
      positive_prompt: request.prompt,
      negative_prompt: request.negative_prompt,
      seed: request.seed,
      width: request.width,
      height: request.height,
      extra_params: request.extra_params,
    };

    const comfyuiUrlOverride = loaded.configured_entry?.comfyui_url_override;
    const { workflow: patched } = patchWorkflowForRun(
      loaded.workflow_name,
      loaded.workflow,
      loaded.configured_entry?.mappings,
      runInput,
    );
    const queued = await this.client.queuePrompt(patched, comfyuiUrlOverride);

    await jobRegistry.update(jobId, { prompt_id: queued.prompt_id });

    const history = await this.client.waitForPrompt(queued.prompt_id, comfyuiUrlOverride);
    const detected = detectOutputsFromHistory(history, queued.prompt_id);

    const ids: AssetId[] = [];
    const allOutputs = [
      ...detected.images.map((f) => ({ ...f, kind: 'image' as const })),
      ...detected.videos.map((f) => ({ ...f, kind: 'video' as const })),
    ];

    for (const output of allOutputs) {
      const asset = await assetLibrary.register({
        filePath: output.path,
        jobId,
        projectId: request.project_id,
        title: request.label ?? request.prompt.slice(0, 60),
        tags: request.asset_tags ?? [],
        modality: request.modality,
        backend: 'comfyui-local',
        prompt: request.prompt,
        seed: request.seed,
      });
      ids.push(asset.id);
    }

    if (detected.warnings.length > 0) {
      const job = await jobRegistry.get(jobId);
      if (job) {
        await jobRegistry.update(jobId, {
          warnings: [...job.warnings, ...detected.warnings],
        });
      }
    }

    return ids;
  }
}
