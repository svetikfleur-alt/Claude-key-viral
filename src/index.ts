import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startPlatform } from './platform/index.js';
import { z } from 'zod';
import { ComfyUiClient } from './comfyuiClient.js';
import { evaluateNatureReadiness, getComfyRuntimeInventory, prepareWorkflowRun } from './comfyuiReadiness.js';
import { loadConfig } from './config.js';
import { appendOutputIndex, buildRunLogPath, ensureLogFiles, readOutputIndex, writeRunLog } from './logger.js';
import { renderHtmlCard } from './codegen/htmlCardRenderer.js';
import { renderRemotionVideo } from './codegen/remotionRenderer.js';
import { renderSvgScene, renderSvgSceneVideo } from './codegen/sceneDslRenderer.js';
import { renderCodeImage, saveSvgMarkup } from './codegen/svgRenderer.js';
import { detectOutputsFromHistory } from './outputDetector.js';
import { generateOutputGallery } from './pipeline/outputGallery.js';
import { generateDemoAssetPack } from './pipeline/demoAssetPack.js';
import { generateCinematicTreatmentPack } from './pipeline/cinematicTreatmentPack.js';
import { generateScenarioSuite } from './pipeline/scenarioSuite.js';
import { analyzeReferenceVideo, buildReferenceTreatmentPreview } from './reference/videoReferenceAnalyzer.js';
import type { HtmlCardInput, OutputDetectionResult, RunInput, SvgMarkupInput, SvgTemplateInput, RemotionVideoInput, SvgSceneRenderInput, SvgSceneVideoInput } from './types.js';
import { safeCopyFileIntoDir } from './comfyuiPaths.js';
import { listConfiguredWorkflows, listWorkflowFiles, loadWorkflow } from './workflowStore.js';
import { dryRunPatchWorkflow, inspectWorkflow, patchWorkflowForRun } from './workflowPatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const runInputSchema = {
  workflow_name: z.string().min(1),
  positive_prompt: z.string().min(1),
  negative_prompt: z.string().optional(),
  seed: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  extra_params: z.record(z.unknown()).optional(),
};

async function getRuntime() {
  const config = await loadConfig(projectRoot);
  await ensureLogFiles(config);
  return {
    config,
    client: new ComfyUiClient(config),
  };
}

function toRunParameters(value: unknown): Record<string, unknown> {
  // Inputs are typically already plain JSON (zod output), but we clone defensively
  // to avoid accidental mutation downstream.
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

function singleOutputResult(filePath: string, type: 'image' | 'video', format?: string): OutputDetectionResult {
  const filename = path.basename(filePath);
  const record = { type, path: filePath, filename, format };
  return {
    images: type === 'image' ? [record] : [],
    videos: type === 'video' ? [record] : [],
    other: [],
    warnings: [],
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function durationSeconds(startedAtMs: number): number {
  return Number(((Date.now() - startedAtMs) / 1000).toFixed(3));
}

function configuredComfyUrls(config: Awaited<ReturnType<typeof loadConfig>>, preferredUrl?: string): string[] {
  const urls = [
    preferredUrl,
    config.comfyui_url,
    ...Object.values(config.workflows).map((entry) => entry.comfyui_url_override),
    'http://127.0.0.1:8000',
    'http://127.0.0.1:8188',
  ].filter((url): url is string => typeof url === 'string' && url.length > 0);

  return Array.from(new Set(urls));
}

async function findReachableComfyUrl(
  client: ComfyUiClient,
  config: Awaited<ReturnType<typeof loadConfig>>,
  preferredUrl?: string,
) {
  const results = [];
  for (const url of configuredComfyUrls(config, preferredUrl)) {
    const health = await client.healthCheckUrl(url);
    results.push(health);
    if (health.reachable) return { comfyuiUrl: url, results };
  }
  return { comfyuiUrl: undefined, results };
}

async function writeFailedRunLog(params: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  logFile: string;
  workflow_name: string;
  prompt_id?: string;
  comfyui_url?: string;
  input_parameters: Record<string, unknown>;
  prompt_json?: Record<string, unknown>;
  error: unknown;
}): Promise<void> {
  const message = formatErrorMessage(params.error);
  await writeRunLog(params.logFile, {
    timestamp: new Date().toISOString(),
    workflow_name: params.workflow_name,
    prompt_id: params.prompt_id,
    comfyui_url: params.comfyui_url,
    prompt_json: params.prompt_json,
    input_parameters: params.input_parameters,
    status: 'failed',
    error: message,
  });
}


async function main() {
  const server = new McpServer({ name: 'comfyui-mcp-runner', version: '1.0.0' });

  async function runWorkflow(input: RunInput) {
    const { config, client } = await getRuntime();
    const loaded = await loadWorkflow(config, input.workflow_name);
    const preferredUrl = loaded.configured_entry?.comfyui_url_override ?? config.comfyui_url;
    const resolved = await findReachableComfyUrl(client, config, preferredUrl);
    if (!resolved.comfyuiUrl) {
      return { ok: false as const, text: JSON.stringify({ status: 'unreachable', results: resolved.results }, null, 2) };
    }
    const comfyuiUrl = resolved.comfyuiUrl;

    const prepared = await prepareWorkflowRun(config, client, loaded, input, comfyuiUrl);
    const patched = patchWorkflowForRun(loaded.workflow_name, loaded.workflow, loaded.configured_entry?.mappings, prepared.input);
    const patchedWorkflow = patched.workflow;
    const runId = randomUUID();
    const logFile = buildRunLogPath(config, runId);
    const started = Date.now();

    try {
      const queued = await client.queuePrompt(patchedWorkflow, comfyuiUrl);
      const history = await client.waitForPrompt(queued.prompt_id, comfyuiUrl);
      const outputs = detectOutputsFromHistory(history, queued.prompt_id);
      const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));
      const warnings = [...prepared.warnings, ...patched.warnings, ...outputs.warnings];
      const resolvedOutputDir = config.comfyui_output_dir_abs;
      const resolvedOutputPaths = typeof resolvedOutputDir === 'string'
        ? outputs.images.flatMap((item) => (item.filename ? [path.join(resolvedOutputDir, item.subfolder ?? '', item.filename)] : []))
        : [];

      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: loaded.workflow_name,
        prompt_id: queued.prompt_id,
        comfyui_url: comfyuiUrl,
        prompt_json: patchedWorkflow,
        input_parameters: {
          positive_prompt: prepared.input.positive_prompt,
          negative_prompt: prepared.input.negative_prompt,
          seed: prepared.input.seed,
          width: prepared.input.width,
          height: prepared.input.height,
          extra_params: prepared.input.extra_params,
        },
        duration_seconds: durationSeconds,
        status: 'completed',
        outputs,
        warnings,
      });

      await appendOutputIndex(config, {
        timestamp: new Date().toISOString(),
        workflow_name: loaded.workflow_name,
        prompt_id: queued.prompt_id,
        duration_seconds: durationSeconds,
        outputs,
        log_file: logFile,
      });

      return {
        ok: true as const,
        text: JSON.stringify({
          status: 'completed',
          workflow_name: loaded.workflow_name,
          prompt_id: queued.prompt_id,
          output_files: {
            images: outputs.images,
            videos: outputs.videos,
            other: outputs.other,
          },
          duration_seconds: durationSeconds,
          log_file: logFile,
          patch_warnings: patched.warnings,
          runtime_inventory: prepared.inventory,
          resolved_output_paths: resolvedOutputPaths,
          warnings,
        }, null, 2),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: loaded.workflow_name,
        prompt_id: runId,
        comfyui_url: comfyuiUrl,
        prompt_json: patchedWorkflow,
        input_parameters: {
          positive_prompt: prepared.input.positive_prompt,
          negative_prompt: prepared.input.negative_prompt,
          seed: prepared.input.seed,
          width: prepared.input.width,
          height: prepared.input.height,
          extra_params: prepared.input.extra_params,
        },
        status: 'failed',
        error: message,
      });
      return { ok: false as const, text: JSON.stringify({ status: 'failed', workflow_name: loaded.workflow_name, error: message, log_file: logFile }, null, 2) };
    }
  }

  server.tool('health_check_comfyui', {}, async () => {
    const { config, client } = await getRuntime();
    const results = [];
    for (const url of configuredComfyUrls(config)) {
      results.push(await client.healthCheckUrl(url));
    }
    const reachable = results.some((result) => result.reachable);
    return { content: [{ type: 'text', text: JSON.stringify({ status: reachable ? 'ok' : 'unreachable', results }, null, 2) }] };
  });

  server.tool('inspect_comfyui_runtime', {}, async () => {
    const { config, client } = await getRuntime();
    const resolved = await findReachableComfyUrl(client, config, config.comfyui_url);
    if (!resolved.comfyuiUrl) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ status: 'unreachable', results: resolved.results }, null, 2),
        }],
        isError: true,
      };
    }
    const inventory = await getComfyRuntimeInventory(client, resolved.comfyuiUrl);
    const nature = evaluateNatureReadiness(inventory);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'ok',
          comfyui_url: resolved.comfyuiUrl,
          inventory,
          nature_readiness: nature,
        }, null, 2),
      }],
    };
  });

  server.tool('list_comfyui_workflows', {}, async () => {
    const { config } = await getRuntime();
    const workflows = await listConfiguredWorkflows(config);
    const files = await listWorkflowFiles(config);
    const fileSet = new Set(files.map((file) => file.file));
    const warnings = workflows
      .filter((workflow) => !fileSet.has(workflow.file))
      .map((workflow) => `Configured workflow '${workflow.workflow_name}' points to missing file '${workflow.file}'.`);

    return { content: [{ type: 'text', text: JSON.stringify({ workflows, files, warnings }, null, 2) }] };
  });

  server.tool('inspect_comfyui_workflow', { workflow_name: z.string().min(1) }, async ({ workflow_name }) => {
    const { config } = await getRuntime();
    const loaded = await loadWorkflow(config, workflow_name);
    const summary = inspectWorkflow(loaded.workflow_name, loaded.workflow_file, loaded.workflow);
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  });

  server.tool('dry_run_comfyui_workflow', runInputSchema, async (input: RunInput) => {
    const { config } = await getRuntime();
    const loaded = await loadWorkflow(config, input.workflow_name);
    const result = dryRunPatchWorkflow(loaded.workflow_name, loaded.workflow, loaded.configured_entry?.mappings, input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('run_comfyui_workflow', runInputSchema, async (input: RunInput) => {
    const result = await runWorkflow(input);
    return { content: [{ type: 'text', text: result.text }], isError: !result.ok };
  });

  server.tool('copy_generated_png_to_comfyui_input', {
    source_png: z.string().min(1),
    dest_filename: z.string().min(1).optional(),
    comfyui_input_dir: z.string().min(1),
  }, async ({ source_png, dest_filename, comfyui_input_dir }) => {
    const { config } = await getRuntime();
    const runId = randomUUID();
    const logFile = buildRunLogPath(config, runId);
    const started = Date.now();
    try {
      const sourcePath = path.resolve(config.generated_media_dir_abs, source_png);
      const copiedTo = await safeCopyFileIntoDir({
        sourcePath,
        destDir: comfyui_input_dir,
        destFilename: dest_filename ?? 'robot-source.png',
      });
      const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'copy-to-comfyui-input',
        prompt_id: runId,
        input_parameters: { source_png, dest_filename, comfyui_input_dir },
        duration_seconds: durationSeconds,
        status: 'completed',
        outputs: singleOutputResult(copiedTo, 'image', 'png'),
      });
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', copied_to: copiedTo, log_file: logFile }, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'copy-to-comfyui-input',
        prompt_id: runId,
        input_parameters: { source_png, dest_filename, comfyui_input_dir },
        status: 'failed',
        error: message,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'failed', error: message, log_file: logFile }, null, 2) }], isError: true };
    }
  });

  server.tool('generate_ai_image_futuristic_robot', {
    prompt: z.string().min(1),
    seed: z.number().int().nonnegative().optional(),
    source_image: z.string().min(1).optional(),
  }, async ({ prompt, seed, source_image }) => {
    const { config } = await getRuntime();
    const workflowName = 'qwen-image-edit-pro';
    const loaded = await loadWorkflow(config, workflowName);
    const defaults = loaded.configured_entry?.default_inputs ?? {};
    const input: RunInput = {
      workflow_name: workflowName,
      positive_prompt: prompt,
      seed: seed ?? (typeof defaults.seed === 'number' ? defaults.seed : undefined),
      extra_params: {
        ...(typeof defaults.extra_params === 'object' && defaults.extra_params ? defaults.extra_params as Record<string, unknown> : {}),
        ...(source_image ? { source_image } : {}),
      },
    };
    const result = await runWorkflow(input);
    return { content: [{ type: 'text', text: result.text }], isError: !result.ok };
  });

  server.tool('generate_ai_video_futuristic_robot', {
    prompt: z.string().min(1),
    seed: z.number().int().nonnegative().optional(),
    duration_seconds: z.number().int().min(5).max(10).optional(),
    start_image: z.string().min(1).optional(),
  }, async ({ prompt, seed, duration_seconds, start_image }) => {
    const { config } = await getRuntime();
    const workflowName = 'wan-i2v-pro';
    const loaded = await loadWorkflow(config, workflowName);
    const defaults = loaded.configured_entry?.default_inputs ?? {};
    const input: RunInput = {
      workflow_name: workflowName,
      positive_prompt: prompt,
      seed: seed ?? (typeof defaults.seed === 'number' ? defaults.seed : undefined),
      extra_params: {
        ...(typeof defaults.extra_params === 'object' && defaults.extra_params ? defaults.extra_params as Record<string, unknown> : {}),
        ...(duration_seconds ? { duration_seconds } : {}),
        ...(start_image ? { start_image } : {}),
      },
    };
    const result = await runWorkflow(input);
    return { content: [{ type: 'text', text: result.text }], isError: !result.ok };
  });

  server.tool('list_recent_outputs', {
    limit: z.number().int().positive().max(100).optional(),
    type: z.enum(['image', 'video', 'all']).optional(),
  }, async ({ limit, type }) => {
    const { config } = await getRuntime();
    const entries = await readOutputIndex(config);
    const selectedType = type ?? 'all';
    const filtered = selectedType === 'all'
      ? entries
      : entries.filter((entry) => (
        (selectedType === 'image' && entry.outputs.images.length > 0)
        || (selectedType === 'video' && entry.outputs.videos.length > 0)
      ));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          outputs: filtered.slice(0, limit ?? 10),
          message: filtered.length > 0 ? `Found ${filtered.length} output record(s).` : 'No recorded outputs yet. Run a workflow first to populate logs/output-index.json.',
        }, null, 2),
      }],
    };
  });

  server.tool('list_media_templates', {}, async () => ({
    content: [{
      type: 'text',
      text: JSON.stringify({
        html_card_templates: [
          'project_hero_banner',
          'social_launch_card',
          'feature_overview_card',
          'capability_card',
        ],
        svg_templates: [
          'github_hero_banner',
          'pipeline_diagram',
          'social_launch_card',
          'feature_card',
        ],
        scene_graph_nodes: [
          'rect',
          'line',
          'circle',
          'ellipse',
          'path',
          'polygon',
          'text',
          'image',
          'group',
          'stack',
        ],
        scene_graph_defs: [
          'linear_gradient',
          'radial_gradient',
          'drop_shadow_filter',
        ],
        remotion_visual_styles: [
          'presentation',
          'pipeline_intro',
          'cinematic_robot',
          'cinematic_treatment',
          'scene_sequence',
        ],
        demo_asset_pack: {
          output_structure: [
            'outputs/runs/<timestamp>/00_manifest.md',
            'outputs/runs/<timestamp>/01_static-launch-assets/',
            'outputs/runs/<timestamp>/02_pipeline-diagrams/',
            'outputs/runs/<timestamp>/03_social-cards/',
            'outputs/runs/<timestamp>/04_video-codegen/',
            'outputs/runs/<timestamp>/05_comfyui-placeholder-or-manual-test/',
            'outputs/runs/<timestamp>/06_cinematic-treatment/ (optional)',
            'outputs/runs/<timestamp>/99_report.md',
          ],
        },
      }, null, 2),
    }],
  }));

  server.tool('render_code_image', {
    template: z.enum(['project_hero_banner', 'social_launch_card', 'feature_overview_card', 'capability_card']),
    title: z.string().min(1),
    subtitle: z.string().min(1),
    eyebrow: z.string().optional(),
    bullets: z.array(z.string().min(1)).max(5).optional(),
    badges: z.array(z.string().min(1)).max(4).optional(),
    footer: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    output_name: z.string().min(1).optional(),
  }, async (input: HtmlCardInput) => {
    const { config } = await getRuntime();
    const runId = randomUUID();
    const logFile = buildRunLogPath(config, runId);
    const started = Date.now();
    try {
      const result = await renderHtmlCard(input, config.generated_media_dir_abs);
      const outputs: OutputDetectionResult = {
        images: [
          { type: 'image', path: result.png_path, filename: path.basename(result.png_path), format: 'png' },
          { type: 'image', path: result.svg_path, filename: path.basename(result.svg_path), format: 'svg' },
        ],
        videos: [],
        other: [],
        warnings: [],
      };
      const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-html-card',
        prompt_id: runId,
        input_parameters: toRunParameters(input),
        duration_seconds: durationSeconds,
        status: 'completed',
        outputs,
        warnings: result.warnings,
      });
      await appendOutputIndex(config, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-html-card',
        prompt_id: runId,
        duration_seconds: durationSeconds,
        outputs,
        log_file: logFile,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, duration_seconds: durationSeconds, log_file: logFile }, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-html-card',
        prompt_id: runId,
        input_parameters: toRunParameters(input),
        status: 'failed',
        error: message,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'failed', error: message, log_file: logFile }, null, 2) }], isError: true };
    }
  });

  server.tool('generate_demo_asset_pack', {
    reference_video_path: z.string().min(1).optional(),
    reference_notes: z.string().optional(),
  }, async ({ reference_video_path, reference_notes }) => {
    const result = await generateDemoAssetPack(projectRoot, reference_video_path ? {
      referenceVideoPath: reference_video_path,
      referenceNotes: reference_notes,
    } : undefined);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'completed',
          run_dir: result.run_dir,
          manifest_path: result.manifest_path,
          report_path: result.report_path,
          outputs_index: result.index_path,
          gallery_path: result.gallery_path,
          assets_generated: result.assets.length,
          skipped: result.skipped,
        }, null, 2),
      }],
    };
  });

  server.tool('generate_scenario_suite', {
    include_video: z.boolean().optional(),
  }, async ({ include_video }) => {
    const result = await generateScenarioSuite(projectRoot, { includeVideo: include_video ?? true });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'completed',
          run_dir: result.run_dir,
          manifest_path: result.manifest_path,
          report_path: result.report_path,
          outputs_index: result.index_path,
          gallery_path: result.gallery_path,
          assets_generated: result.assets.length,
          skipped: result.skipped,
        }, null, 2),
      }],
    };
  });

  server.tool('generate_cinematic_treatment_pack', {
    video_path: z.string().min(1),
    notes: z.string().optional(),
  }, async ({ video_path, notes }) => {
    const now = new Date();
    const runDir = path.join(
      projectRoot,
      'outputs',
      'runs',
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`,
    );
    const result = await generateCinematicTreatmentPack({
      projectRoot,
      runDir,
      referenceVideoPath: video_path,
      notes,
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'completed',
          section_dir: result.section_dir,
          manifest_path: result.manifest_path,
          report_path: result.report_path,
          assets_generated: result.assets.length,
          summary: result.summary_lines,
        }, null, 2),
      }],
    };
  });

  server.tool('build_output_gallery', {}, async () => {
    const gallery = await generateOutputGallery(path.join(projectRoot, 'outputs'));
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'completed',
          gallery_path: gallery.html_path,
          run_count: gallery.run_count,
        }, null, 2),
      }],
    };
  });

  server.tool('analyze_reference_video', {
    video_path: z.string().min(1),
    notes: z.string().optional(),
  }, async ({ video_path, notes }) => {
    const result = await analyzeReferenceVideo({
      projectRoot,
      videoPath: video_path,
      notes,
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'completed',
          output_dir: result.output_dir,
          metadata_path: result.metadata_path,
          style_brief_path: result.style_brief_path,
          shot_plan_path: result.shot_plan_path,
          notes_path: result.notes_path,
          frames: result.frames,
          metadata: result.metadata,
          treatment_preview: buildReferenceTreatmentPreview(result.metadata),
        }, null, 2),
      }],
    };
  });

  server.tool('render_svg_template', {
    template: z.enum(['github_hero_banner', 'pipeline_diagram', 'social_launch_card', 'feature_card']),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    bullets: z.array(z.string().min(1)).max(5).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    output_name: z.string().min(1).optional(),
  }, async (input: SvgTemplateInput) => {
    const { config } = await getRuntime();
    const runId = randomUUID();
    const logFile = buildRunLogPath(config, runId);
    const started = Date.now();
    try {
      const result = await renderCodeImage(input, config.generated_media_dir_abs);
      const outputs = singleOutputResult(result.file_path, 'image', 'svg');
      const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-template',
        prompt_id: runId,
        input_parameters: toRunParameters(input),
        duration_seconds: durationSeconds,
        status: 'completed',
        outputs,
        warnings: result.warnings,
      });
      await appendOutputIndex(config, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-template',
        prompt_id: runId,
        duration_seconds: durationSeconds,
        outputs,
        log_file: logFile,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, duration_seconds: durationSeconds, log_file: logFile }, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-template',
        prompt_id: runId,
        input_parameters: toRunParameters(input),
        status: 'failed',
        error: message,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'failed', error: message, log_file: logFile }, null, 2) }], isError: true };
    }
  });

  server.tool('render_svg_scene', {
    scene: z.record(z.unknown()),
    output_name: z.string().min(1).optional(),
    rasterize_png: z.boolean().optional(),
  }, async (input) => {
    const sceneInput = input as unknown as SvgSceneRenderInput;
    const { config } = await getRuntime();
    const runId = randomUUID();
    const logFile = buildRunLogPath(config, runId);
    const started = Date.now();
    try {
      const result = await renderSvgScene(sceneInput, config.generated_media_dir_abs);
      const outputs: OutputDetectionResult = {
        images: [
          { type: 'image', path: result.svg_path, filename: path.basename(result.svg_path), format: 'svg' },
          ...(result.png_path ? [{ type: 'image' as const, path: result.png_path, filename: path.basename(result.png_path), format: 'png' }] : []),
        ],
        videos: [],
        other: [],
        warnings: [],
      };
      const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-scene',
        prompt_id: runId,
        input_parameters: toRunParameters(sceneInput),
        duration_seconds: durationSeconds,
        status: 'completed',
        outputs,
        warnings: result.warnings,
      });
      await appendOutputIndex(config, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-scene',
        prompt_id: runId,
        duration_seconds: durationSeconds,
        outputs,
        log_file: logFile,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, duration_seconds: durationSeconds, log_file: logFile }, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-scene',
        prompt_id: runId,
        input_parameters: toRunParameters(sceneInput),
        status: 'failed',
        error: message,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'failed', error: message, log_file: logFile }, null, 2) }], isError: true };
    }
  });

  server.tool('render_svg_scene_video', {
    title: z.string().min(1),
    subtitle: z.string().optional(),
    theme: z.enum(['sunset', 'ocean', 'forest', 'slate']).optional(),
    scenes: z.array(z.object({
      scene: z.record(z.unknown()),
      headline: z.string().optional(),
      body: z.string().optional(),
      accent: z.string().optional(),
      duration_seconds: z.number().positive().max(30).optional(),
    })).min(1).max(8),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().int().positive().max(60).optional(),
    output_name: z.string().min(1).optional(),
  }, async (input) => {
    const sceneVideoInput = input as unknown as SvgSceneVideoInput;
    const { config } = await getRuntime();
    const runId = randomUUID();
    const logFile = buildRunLogPath(config, runId);
    const started = Date.now();
    try {
      const result = await renderSvgSceneVideo(sceneVideoInput, config.generated_media_dir_abs);
      const outputs = singleOutputResult(result.file_path, 'video', 'mp4');
      const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-scene-video',
        prompt_id: runId,
        input_parameters: toRunParameters(sceneVideoInput),
        duration_seconds: durationSeconds,
        status: 'completed',
        outputs,
        warnings: result.warnings,
      });
      await appendOutputIndex(config, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-scene-video',
        prompt_id: runId,
        duration_seconds: durationSeconds,
        outputs,
        log_file: logFile,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, render_duration_seconds: durationSeconds, log_file: logFile }, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-scene-video',
        prompt_id: runId,
        input_parameters: toRunParameters(sceneVideoInput),
        status: 'failed',
        error: message,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'failed', error: message, log_file: logFile }, null, 2) }], isError: true };
    }
  });

  server.tool('save_svg_markup', {
    svg_markup: z.string().min(1),
    output_name: z.string().min(1).optional(),
  }, async (input: SvgMarkupInput) => {
    const { config } = await getRuntime();
    const runId = randomUUID();
    const logFile = buildRunLogPath(config, runId);
    const started = Date.now();
    try {
      const result = await saveSvgMarkup(input, config.generated_media_dir_abs);
      const outputs = singleOutputResult(result.file_path, 'image', 'svg');
      const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-markup',
        prompt_id: runId,
        input_parameters: { output_name: input.output_name, svg_length: input.svg_markup.length },
        duration_seconds: durationSeconds,
        status: 'completed',
        outputs,
        warnings: result.warnings,
      });
      await appendOutputIndex(config, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-markup',
        prompt_id: runId,
        duration_seconds: durationSeconds,
        outputs,
        log_file: logFile,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, duration_seconds: durationSeconds, log_file: logFile }, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-svg-markup',
        prompt_id: runId,
        input_parameters: { output_name: input.output_name, svg_length: input.svg_markup.length },
        status: 'failed',
        error: message,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'failed', error: message, log_file: logFile }, null, 2) }], isError: true };
    }
  });

  server.tool('render_remotion_video', {
    title: z.string().min(1),
    subtitle: z.string().optional(),
    theme: z.enum(['sunset', 'ocean', 'forest', 'slate']).optional(),
    visual_style: z.enum(['presentation', 'pipeline_intro', 'cinematic_robot', 'cinematic_treatment', 'scene_sequence']).optional(),
    music_src: z.string().min(1).optional(),
    voiceover_src: z.string().min(1).optional(),
    music_volume: z.number().min(0).max(1).optional(),
    voiceover_volume: z.number().min(0).max(2).optional(),
    scenes: z.array(z.object({
      headline: z.string().min(1),
      body: z.string().optional(),
      accent: z.string().optional(),
      media_data_url: z.string().optional(),
      duration_seconds: z.number().positive().max(30).optional(),
    })).max(8).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().int().positive().max(60).optional(),
    duration_seconds: z.number().positive().max(120).optional(),
    output_name: z.string().min(1).optional(),
  }, async (input: RemotionVideoInput) => {
    const { config } = await getRuntime();
    const runId = randomUUID();
    const logFile = buildRunLogPath(config, runId);
    const started = Date.now();
    try {
      const result = await renderRemotionVideo(input, config.generated_media_dir_abs);
      const outputs = singleOutputResult(result.file_path, 'video', 'mp4');
      const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-remotion-video',
        prompt_id: runId,
        input_parameters: toRunParameters(input),
        duration_seconds: durationSeconds,
        status: 'completed',
        outputs,
        warnings: result.warnings,
      });
      await appendOutputIndex(config, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-remotion-video',
        prompt_id: runId,
        duration_seconds: durationSeconds,
        outputs,
        log_file: logFile,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, render_duration_seconds: durationSeconds, log_file: logFile }, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunLog(logFile, {
        timestamp: new Date().toISOString(),
        workflow_name: 'codegen-remotion-video',
        prompt_id: runId,
        input_parameters: toRunParameters(input),
        status: 'failed',
        error: message,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'failed', error: message, log_file: logFile }, null, 2) }], isError: true };
    }
  });

  // Optional local HTTP server/dashboard. Disabled by default.
  // Enable by setting `ENABLE_PLATFORM=1`.
  if (process.env.ENABLE_PLATFORM === '1') {
    try {
      const { config } = await getRuntime();
      const platformPort = parseInt(process.env.PLATFORM_PORT ?? '3333', 10);
      await startPlatform(config, projectRoot, platformPort, server);
    } catch (platformError) {
      // Platform HTTP server failure is non-fatal — MCP server continues.
      console.error('[platform] Failed to start HTTP server:', platformError);
    }
  }

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
