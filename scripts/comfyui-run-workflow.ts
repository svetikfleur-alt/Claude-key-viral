import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { ComfyUiClient } from '../src/comfyuiClient.js';
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

  const patched = patchWorkflowForRun(loaded.workflow_name, loaded.workflow, loaded.configured_entry?.mappings, input);
  const runDir = path.join(projectRoot, 'outputs', 'runs', nowStamp());

  await writeRunLog(logFile, {
    timestamp: new Date().toISOString(),
    workflow_name: loaded.workflow_name,
    comfyui_url: comfyUrl,
    input_parameters: input,
    prompt_json: patched.workflow,
    warnings: patched.warnings,
    status: 'preflight',
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
      input_parameters: input,
      prompt_json: patched.workflow,
      warnings: patched.warnings,
      status: 'queued',
    });

    const history = await client.waitForPrompt(promptId, comfyUrl);
    const outputs = detectOutputsFromHistory(history, promptId);
    const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));

    await writeRunLog(logFile, {
      timestamp: new Date().toISOString(),
      workflow_name: loaded.workflow_name,
      prompt_id: promptId,
      comfyui_url: comfyUrl,
      input_parameters: input,
      prompt_json: patched.workflow,
      duration_seconds: durationSeconds,
      status: 'completed',
      outputs,
      warnings: outputs.warnings,
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
      '',
      '### Video files',
      ...outputs.videos.map((item) => `- ${item.path}`),
      '',
      '### Warnings',
      ...(outputs.warnings.length ? outputs.warnings.map((w) => `- ${w}`) : ['- (none)']),
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
      patch_warnings: patched.warnings,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(3));

    await writeRunLog(logFile, {
      timestamp: new Date().toISOString(),
      workflow_name: loaded.workflow_name,
      prompt_id: promptId,
      comfyui_url: comfyUrl,
      input_parameters: input,
      prompt_json: patched.workflow,
      warnings: patched.warnings,
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
      ...(patched.warnings.length ? patched.warnings.map((w) => `- ${w}`) : ['- (none)']),
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
      patch_warnings: patched.warnings,
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`run failed: ${(error as Error).message}\n`);
  process.exitCode = 2;
});
