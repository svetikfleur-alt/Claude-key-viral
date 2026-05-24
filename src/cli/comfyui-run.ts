import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { ComfyUiClient } from '../comfyuiClient.js';
import { prepareWorkflowRun } from '../comfyuiReadiness.js';
import { loadWorkflow } from '../workflowStore.js';
import { patchWorkflowForRun } from '../workflowPatcher.js';
import { detectOutputsFromHistory } from '../outputDetector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function parseJsonArg(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid JSON for --extra: ${(error as Error).message}`);
  }
}

async function main() {
  const workflowName = getArg('--workflow') ?? 'passthrough-image';
  const positivePrompt = getArg('--positive') ?? '(unused)';
  const extraParams = parseJsonArg(getArg('--extra')) ?? {};

  const config = await loadConfig(projectRoot);
  const client = new ComfyUiClient(config);

  const health = await client.healthCheckUrl(config.comfyui_url);
  if (!health.reachable) {
    process.stderr.write(`ComfyUI is not reachable at ${config.comfyui_url}. ${health.message}\n`);
    process.exitCode = 2;
    return;
  }

  const loaded = await loadWorkflow(config, workflowName);
  const comfyUrl = loaded.configured_entry?.comfyui_url_override ?? config.comfyui_url;
  const prepared = await prepareWorkflowRun(config, client, loaded, {
    workflow_name: workflowName,
    positive_prompt: positivePrompt,
    extra_params: extraParams,
  }, comfyUrl);

  const patched = patchWorkflowForRun(loaded.workflow_name, loaded.workflow, loaded.configured_entry?.mappings, prepared.input);

  const queued = await client.queuePrompt(patched.workflow, comfyUrl);
  const history = await client.waitForPrompt(queued.prompt_id, comfyUrl);
  const outputs = detectOutputsFromHistory(history, queued.prompt_id);

  const outDir = config.comfyui_output_dir_abs;
  const resolvedOutputPaths = typeof outDir === 'string'
    ? outputs.images.map((item) => path.join(outDir, item.subfolder ?? '', item.filename ?? item.path))
    : [];

  process.stdout.write(`${JSON.stringify({
    status: 'completed',
    comfyui_url: comfyUrl,
    workflow_name: loaded.workflow_name,
    prompt_id: queued.prompt_id,
    patch_warnings: [...prepared.warnings, ...patched.warnings],
    runtime_inventory: prepared.inventory,
    outputs,
    resolved_output_paths: resolvedOutputPaths,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`run failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
