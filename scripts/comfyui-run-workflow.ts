import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { ComfyUiClient } from '../src/comfyuiClient.js';
import { prepareWorkflowRun } from '../src/comfyuiReadiness.js';
import { ensureLogFiles, writeRunLog } from '../src/logger.js';
import { loadWorkflow } from '../src/workflowStore.js';
import { patchWorkflowForRun } from '../src/workflowPatcher.js';
import { detectOutputsFromHistory } from '../src/outputDetector.js';

type Args = {
  workflow_name: string;
  positive_prompt: string;
  negative_prompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  extra_params?: Record<string, unknown>;
};

function parseArgs(): Args {
  const [workflow_name, positive_prompt] = process.argv.slice(2);
  if (!workflow_name || !positive_prompt) {
    throw new Error('Usage: npm run comfyui:run -- <workflow_name> <positive_prompt>');
  }
  return { workflow_name, positive_prompt };
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function writeRunReport(runDir: string, lines: string[]) {
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'RUN_REPORT.md'), `${lines.join('\n')}\n`, 'utf8');
}

async function findNewestMatchingFile(dir: string, prefix: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const matches: Array<{ file: string; mtime: number }> = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const full = path.join(dir, entry.name);
      try {
        const stat = await fs.stat(full);
        matches.push({ file: full, mtime: stat.mtimeMs });
      } catch {
        // ignore
      }
    }
    matches.sort((a, b) => b.mtime - a.mtime);
    return matches[0]?.file;
  } catch {
    return undefined;
  }
}

async function main() {
  const args = parseArgs();
  const projectRoot = process.cwd();
  const config = await loadConfig(projectRoot);
  await ensureLogFiles(config);
  const client = new ComfyUiClient(config);

  const loaded = await loadWorkflow(config, args.workflow_name);
  const configuredUrl = loaded.configured_entry?.comfyui_url_override;
  const candidates = [
    configuredUrl,
    config.comfyui_url,
    'http://127.0.0.1:8000',
    'http://127.0.0.1:8188',
  ].filter(Boolean) as string[];
  const uniqueCandidates = Array.from(new Set(candidates));

  let comfyUrl: string | undefined;
  let lastHealth = await client.healthCheckUrl(uniqueCandidates[0]);
  for (const candidate of uniqueCandidates) {
    const health = await client.healthCheckUrl(candidate);
    lastHealth = health;
    if (health.reachable) {
      comfyUrl = candidate;
      break;
    }
  }

  if (!comfyUrl) {
    await writeRunReport(path.join(projectRoot, 'outputs', 'runs', nowStamp()), [
      '# RUN_REPORT',
      '',
      `- Status: FAILED`,
      `- Reason: ComfyUI unreachable (tried: ${uniqueCandidates.join(', ')})`,
      '',
      lastHealth.message,
      '',
      'Next step: start ComfyUI and retry.',
    ]);
    process.stdout.write(`${JSON.stringify({ status: 'unreachable', tried: uniqueCandidates, last: lastHealth }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const runId = randomUUID();
  const started = Date.now();
  const logFile = path.join(config.logs_dir_abs, `${runId}.json`);

  const input = {
    workflow_name: args.workflow_name,
    positive_prompt: args.positive_prompt,
    negative_prompt: args.negative_prompt,
    seed: args.seed,
    width: args.width,
    height: args.height,
    extra_params: args.extra_params,
  };

  const prepared = await prepareWorkflowRun(config, client, loaded, input, comfyUrl);
  const patched = patchWorkflowForRun(loaded.workflow_name, loaded.workflow, loaded.configured_entry?.mappings, prepared.input);
  const runDir = path.join(projectRoot, 'outputs', 'runs', nowStamp());

  await writeRunLog(logFile, {
    timestamp: new Date().toISOString(),
    workflow_name: loaded.workflow_name,
    comfyui_url: comfyUrl,
    input_parameters: prepared.input,
    prompt_json: patched.workflow,
    warnings: [...prepared.warnings, ...patched.warnings],
    status: 'queued',
  });

  let promptId: string | undefined;
  try {
    const queued = await client.queuePrompt(patched.workflow, comfyUrl);
    promptId = queued.prompt_id;

    await writeRunLog(logFile, {
      timestamp: new Date().toISOString(),
      workflow_name: loaded.workflow_name,
      prompt_id: promptId,
      comfyui_url: comfyUrl,
      input_parameters: prepared.input,
      prompt_json: patched.workflow,
      warnings: [...prepared.warnings, ...patched.warnings],
      status: 'queued',
    });

    const history = await client.waitForPrompt(promptId, comfyUrl);
  const outputs = detectOutputsFromHistory(history, promptId);
  const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));
  const resolvedOutputDir = config.comfyui_output_dir_abs;
  let resolvedOutputPaths = resolvedOutputDir
    ? outputs.images.map((item) => path.join(resolvedOutputDir, item.subfolder ?? '', item.filename))
    : [];

  // Fallback: Desktop-safe ComfyUI can return empty outputs for fully cached runs.
  // If that happens, try to locate the newest file matching the SaveImage prefix.
  if (resolvedOutputPaths.length === 0 && typeof resolvedOutputDir === 'string') {
    const prefix = String(input.extra_params?.filename_prefix ?? '').trim();
    if (prefix) {
      const newest = await findNewestMatchingFile(resolvedOutputDir, prefix);
      if (newest) {
        resolvedOutputPaths = [newest];
      }
    }
  }

  await writeRunLog(logFile, {
      timestamp: new Date().toISOString(),
      workflow_name: loaded.workflow_name,
      prompt_id: promptId,
      comfyui_url: comfyUrl,
      input_parameters: prepared.input,
      prompt_json: patched.workflow,
      duration_seconds: durationSeconds,
      status: 'completed',
    outputs,
    warnings: [...prepared.warnings, ...patched.warnings, ...outputs.warnings],
  });

    await writeRunReport(runDir, [
      '# RUN_REPORT',
      '',
      `- Status: COMPLETED`,
      `- Workflow: ${loaded.workflow_name}`,
      `- ComfyUI URL: ${comfyUrl}`,
      `- Prompt ID: ${promptId}`,
      `- Duration: ${durationSeconds}s`,
      `- Log file: ${path.relative(projectRoot, logFile)}`,
      '',
      '## Outputs (detected)',
      '',
      `- Images: ${outputs.images.length}`,
      `- Videos: ${outputs.videos.length}`,
      `- Other: ${outputs.other.length}`,
      '',
    '### Image files',
    ...outputs.images.map((item) => `- ${item.path}`),
    ...(resolvedOutputPaths.length ? [
      '',
      '### Resolved output paths (from config.comfyui_output_dir)',
      ...resolvedOutputPaths.map((p) => `- ${p}`),
    ] : []),
      '',
      '### Video files',
      ...outputs.videos.map((item) => `- ${item.path}`),
      '',
      '### Warnings',
      ...([ ...prepared.warnings, ...outputs.warnings ].length ? [ ...prepared.warnings, ...outputs.warnings ].map((w) => `- ${w}`) : ['- (none)']),
      '',
      '### Patch warnings',
      ...(patched.warnings.length ? patched.warnings.map((w) => `- ${w}`) : ['- (none)']),
    ]);

    process.stdout.write(`${JSON.stringify({
      status: 'completed',
      workflow_name: loaded.workflow_name,
      comfyui_url: comfyUrl,
      prompt_id: promptId,
      duration_seconds: durationSeconds,
      log_file: logFile,
      run_report: path.join(runDir, 'RUN_REPORT.md'),
    outputs,
    patch_warnings: [...prepared.warnings, ...patched.warnings],
    resolved_output_paths: resolvedOutputPaths,
  }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));

    await writeRunLog(logFile, {
      timestamp: new Date().toISOString(),
      workflow_name: loaded.workflow_name,
      prompt_id: promptId,
      comfyui_url: comfyUrl,
      input_parameters: prepared.input,
      prompt_json: patched.workflow,
      warnings: [...prepared.warnings, ...patched.warnings],
      duration_seconds: durationSeconds,
      status: 'failed',
      error: message,
    });

    await writeRunReport(runDir, [
      '# RUN_REPORT',
      '',
      `- Status: FAILED`,
      `- Workflow: ${loaded.workflow_name}`,
      `- ComfyUI URL: ${comfyUrl}`,
      ...(promptId ? [`- Prompt ID: ${promptId}`] : []),
      `- Duration: ${durationSeconds}s`,
      `- Log file: ${path.relative(projectRoot, logFile)}`,
      '',
      `Error: ${message}`,
      '',
      '## Patch warnings',
      ...([ ...prepared.warnings, ...patched.warnings ].length ? [ ...prepared.warnings, ...patched.warnings ].map((w) => `- ${w}`) : ['- (none)']),
      '',
      'Next step: check ComfyUI stdout/stderr logs and try a lighter workflow (or GPU).',
    ]);

    process.stdout.write(`${JSON.stringify({
      status: 'failed',
      workflow_name: loaded.workflow_name,
      comfyui_url: comfyUrl,
      prompt_id: promptId,
      duration_seconds: durationSeconds,
      log_file: logFile,
      run_report: path.join(runDir, 'RUN_REPORT.md'),
      error: message,
      patch_warnings: [...prepared.warnings, ...patched.warnings],
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`run failed: ${(error as Error).message}\n`);
  process.exitCode = 2;
});
