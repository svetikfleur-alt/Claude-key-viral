import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { AppConfig, Confidence, FieldMapping, JsonObject, PresetFile, RunInput, WorkflowMapping } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const configPath = path.join(projectRoot, 'config.json');
const configExamplePath = path.join(projectRoot, 'config.example.json');

const cfgSchema = z.object({ comfyui_url: z.string().url(), workflows_dir: z.string().min(1), logs_dir: z.string().min(1), default_timeout_seconds: z.number().positive(), polling_interval_seconds: z.number().positive(), workflow_mappings: z.record(z.unknown()).default({}), presets_dir: z.string().min(1).optional(), outputs_index_file: z.string().min(1).optional() });
const runToolSchema = { workflow_name: z.string().min(1), positive_prompt: z.string().min(1), negative_prompt: z.string().optional(), seed: z.number().int().nonnegative().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), wait: z.boolean().optional(), preset_name: z.string().min(1).optional(), extra_params: z.record(z.unknown()).optional() };

function resolveSafeDir(root: string, p: string) { return path.resolve(root, p); }
function assertInside(base: string, target: string) { if (!(target === base || target.startsWith(base + path.sep))) throw new Error(`Path safety error. Cause: resolved path escapes '${base}'. Fix: use a name/path inside the configured directory.`); }
const nowIso = () => new Date().toISOString();

function friendlyError(what: string, cause: string, fix: string) { return `${what} Cause: ${cause} Suggested fix: ${fix}`; }

async function loadConfig(): Promise<AppConfig> {
  const srcPath = await fs.access(configPath).then(() => configPath).catch(() => configExamplePath);
  const parsed = cfgSchema.safeParse(JSON.parse(await fs.readFile(srcPath, 'utf8')));
  if (!parsed.success) throw new Error(friendlyError(`Invalid config file (${path.basename(srcPath)}).`, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 'Fix config JSON fields and types according to config.example.json.'));
  return parsed.data as AppConfig;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (error) { if (error instanceof Error && error.name === 'AbortError') throw new Error(friendlyError('ComfyUI request timed out.', `No response within ${timeoutMs}ms for ${url}.`, 'Increase default_timeout_seconds or reduce workflow complexity.')); throw error; }
  finally { clearTimeout(timer); }
}

function sanitizePresetName(name: string): string {
  const sanitized = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!sanitized) throw new Error(friendlyError('Invalid preset name.', 'Preset name became empty after sanitization.', 'Use letters, numbers, dash, underscore.'));
  return sanitized;
}

async function readWorkflow(workflowsDir: string, workflowName: string): Promise<{ workflowPath: string; workflow: JsonObject }> {
  const workflowPath = path.resolve(workflowsDir, `${workflowName}.json`); assertInside(workflowsDir, workflowPath);
  let raw: string;
  try { raw = await fs.readFile(workflowPath, 'utf8'); }
  catch { throw new Error(friendlyError('Workflow file not found.', `No file at ${workflowPath}.`, `Add '${workflowName}.json' inside workflows_dir.`)); }
  try { return { workflowPath, workflow: JSON.parse(raw) as JsonObject }; }
  catch { throw new Error(friendlyError('Invalid workflow JSON.', `Failed to parse ${workflowPath}.`, 'Re-export workflow API JSON from ComfyUI and save valid JSON.')); }
}

function getNodeTitle(n: JsonObject): string | undefined {
  const meta = n._meta as JsonObject | undefined;
  const title = meta?.title;
  return typeof title === 'string' ? title : undefined;
}

function detectNodeRoles(nodeId: string, node: JsonObject): Array<{ role: string; confidence: Confidence }> {
  const classType = String(node.class_type ?? '').toLowerCase();
  const title = String(getNodeTitle(node) ?? '').toLowerCase();
  const inputs = node.inputs && typeof node.inputs === 'object' ? Object.keys(node.inputs as JsonObject).join(' ').toLowerCase() : '';
  const hay = `${classType} ${title} ${inputs}`;
  const out: Array<{ role: string; confidence: Confidence }> = [];
  const mark = (r: string, c: Confidence) => out.push({ role: r, confidence: c });
  if (/positive|cliptextencode/.test(hay) && !/negative/.test(hay)) mark('positive prompt node', classType.includes('cliptextencode') ? 'high' : 'medium');
  if (/negative/.test(hay)) mark('negative prompt node', 'high');
  if (/seed/.test(hay)) mark('seed node', 'high');
  if (/width/.test(hay)) mark('width node', 'medium');
  if (/height/.test(hay)) mark('height node', 'medium');
  if (/batch/.test(hay)) mark('batch size node', 'medium');
  if (/frame|frames/.test(hay)) mark('frame count node', 'medium');
  if (/fps/.test(hay)) mark('fps node', 'high');
  if (/saveimage|image/.test(classType)) mark('image output node', classType.includes('saveimage') ? 'high' : 'low');
  if (/video/.test(hay)) mark('video output node', 'medium');
  if (/ksampler|sampler/.test(hay)) mark('sampler node', 'high');
  if (/checkpoint|ckptloader|model/.test(hay)) mark('checkpoint/model node', 'medium');
  if (out.length === 0) mark(`unknown:${nodeId}`, 'low');
  return out;
}

function inspectWorkflow(workflow: JsonObject) {
  const entries = Object.entries(workflow).filter(([, v]) => v && typeof v === 'object');
  const nodes = entries.map(([node_id, n]) => {
    const node = n as JsonObject;
    const inputs = node.inputs && typeof node.inputs === 'object' ? Object.keys(node.inputs as JsonObject) : [];
    const widgets = Array.isArray(node.widgets_values) ? node.widgets_values.slice(0, 5) : undefined;
    return { node_id, class_type: String(node.class_type ?? 'unknown'), title: getNodeTitle(node), likely_roles: detectNodeRoles(node_id, node), inputs_keys: inputs, widgets_values_summary: widgets };
  });
  return { total_node_count: nodes.length, nodes };
}

function findByRole(inspected: ReturnType<typeof inspectWorkflow>, rolePrefix: string) {
  const hit = inspected.nodes.find((n) => n.likely_roles.some((r) => r.role.startsWith(rolePrefix) && (r.confidence === 'high' || r.confidence === 'medium')));
  return hit?.node_id;
}

function suggestMapping(workflowName: string, inspected: ReturnType<typeof inspectWorkflow>, targetType: 'image'|'video'|'generic') {
  const mapping: WorkflowMapping = {};
  const confidence: Record<string, Confidence> = {};
  const warnings: string[] = [];
  const put = (k: keyof WorkflowMapping, role: string, pathArr: string[]) => {
    const nodeId = findByRole(inspected, role);
    if (nodeId) { mapping[k] = { node_id: nodeId, path: pathArr }; confidence[k] = 'medium'; }
  };
  put('positive_prompt', 'positive prompt node', ['inputs', 'text']);
  put('negative_prompt', 'negative prompt node', ['inputs', 'text']);
  put('seed', 'seed node', ['inputs', 'seed']);
  put('width', 'width node', ['inputs', 'width']);
  put('height', 'height node', ['inputs', 'height']);
  const unmapped = ['positive_prompt','negative_prompt','seed','width','height'].filter((k) => !(mapping as JsonObject)[k]);
  if (targetType === 'video' && !inspected.nodes.some((n) => n.likely_roles.some((r) => r.role === 'video output node'))) warnings.push('No obvious video output node detected.');
  if (unmapped.length) warnings.push(`Some important fields are not confidently mapped: ${unmapped.join(', ')}.`);
  const presetSkeleton: PresetFile = { preset_name: `${workflowName}-${targetType}`, workflow_name: workflowName, target_type: targetType, mapping, notes: warnings.length ? warnings : undefined };
  return { mapping, confidence, warnings, unmapped_important_fields: unmapped, preset_skeleton: presetSkeleton };
}

function setMappedValue(workflow: JsonObject, mapping: FieldMapping, value: unknown): void {
  const node = workflow[mapping.node_id];
  if (!node || typeof node !== 'object') throw new Error(friendlyError('Mapping points to missing node ID.', `Node '${mapping.node_id}' does not exist in workflow.`, 'Run inspect_comfyui_workflow and update mapping node_id.'));
  let current: unknown = node;
  for (let i = 0; i < mapping.path.length - 1; i += 1) {
    if (!current || typeof current !== 'object') throw new Error(friendlyError('Mapped node exists but field cannot be patched.', `Path segment '${mapping.path[i]}' is not an object.`, 'Fix mapping path to valid nested object keys.'));
    current = (current as JsonObject)[mapping.path[i]];
  }
  const last = mapping.path[mapping.path.length - 1];
  if (!current || typeof current !== 'object') throw new Error(friendlyError('Mapped node exists but field cannot be patched.', 'Final parent object for mapping path is invalid.', 'Fix mapping path to target an existing field.'));
  (current as JsonObject)[last] = value;
}

function applyWorkflowMappings(workflow: JsonObject, mapping: WorkflowMapping, input: RunInput) {
  if (!mapping.positive_prompt) throw new Error(friendlyError('Missing node mapping.', `No mapping for 'positive_prompt' in workflow '${input.workflow_name}'.`, 'Use suggest_workflow_mapping or update config/preset mapping.'));
  setMappedValue(workflow, mapping.positive_prompt, input.positive_prompt);
  if (input.negative_prompt) { if (!mapping.negative_prompt) throw new Error(friendlyError('Missing node mapping.', `No mapping for 'negative_prompt' in workflow '${input.workflow_name}'.`, 'Add negative_prompt mapping.')); setMappedValue(workflow, mapping.negative_prompt, input.negative_prompt); }
  if (typeof input.seed === 'number') { if (!mapping.seed) throw new Error(friendlyError('Missing node mapping.', `No mapping for 'seed' in workflow '${input.workflow_name}'.`, 'Add seed mapping.')); setMappedValue(workflow, mapping.seed, input.seed); }
  if (typeof input.width === 'number') { if (!mapping.width) throw new Error(friendlyError('Missing node mapping.', `No mapping for 'width' in workflow '${input.workflow_name}'.`, 'Add width mapping.')); setMappedValue(workflow, mapping.width, input.width); }
  if (typeof input.height === 'number') { if (!mapping.height) throw new Error(friendlyError('Missing node mapping.', `No mapping for 'height' in workflow '${input.workflow_name}'.`, 'Add height mapping.')); setMappedValue(workflow, mapping.height, input.height); }
}

function extractOutputPaths(history: JsonObject, promptId: string): { files: string[]; types: string[] } {
  const run = history[promptId] as JsonObject | undefined; if (!run) return { files: [], types: [] };
  const outputs = run.outputs as JsonObject | undefined; if (!outputs) return { files: [], types: [] };
  const files: string[] = []; const types = new Set<string>();
  for (const v of Object.values(outputs)) {
    if (!v || typeof v !== 'object') continue;
    for (const k of ['images', 'videos', 'audio']) {
      const arr = (v as JsonObject)[k]; if (!Array.isArray(arr)) continue; if (k === 'images') types.add('image'); if (k === 'videos') types.add('video');
      for (const item of arr) { if (!item || typeof item !== 'object') continue; const filename = (item as JsonObject).filename; const subfolder = (item as JsonObject).subfolder ?? ''; if (typeof filename === 'string' && typeof subfolder === 'string') files.push(path.posix.join('/output', subfolder, filename)); }
    }
  }
  return { files: [...new Set(files)], types: [...types] };
}

async function main() {
  const config = await loadConfig();
  const workflowsDir = resolveSafeDir(projectRoot, config.workflows_dir);
  const logsDir = resolveSafeDir(projectRoot, config.logs_dir);
  const presetsDir = resolveSafeDir(projectRoot, config.presets_dir ?? './presets');
  const outputsIndexFile = resolveSafeDir(projectRoot, config.outputs_index_file ?? './outputs/index.json');
  await fs.mkdir(workflowsDir, { recursive: true }); await fs.mkdir(logsDir, { recursive: true }); await fs.mkdir(presetsDir, { recursive: true }); await fs.mkdir(path.dirname(outputsIndexFile), { recursive: true });

  async function runLog(runId: string, data: JsonObject) { await fs.appendFile(path.join(logsDir, `${runId}.log`), `${JSON.stringify({ timestamp: nowIso(), ...data })}\n`, 'utf8'); }
  async function addOutputIndex(entry: JsonObject) {
    let items: JsonObject[] = [];
    try { items = JSON.parse(await fs.readFile(outputsIndexFile, 'utf8')) as JsonObject[]; if (!Array.isArray(items)) items = []; } catch {}
    items.unshift(entry); await fs.writeFile(outputsIndexFile, JSON.stringify(items.slice(0, 200), null, 2));
  }

  async function healthCheck(): Promise<void> {
    try { const timeoutMs = Math.floor(config.default_timeout_seconds * 1000); const res = await fetchWithTimeout(`${config.comfyui_url}/history`, { method: 'GET' }, timeoutMs); if (!res.ok) throw new Error(String(res.status)); }
    catch { throw new Error('ComfyUI is unreachable. Cause: no valid response from server. Suggested fix: make sure ComfyUI is running at http://127.0.0.1:8188 and comfyui_url is correct.'); }
  }

  const server = new McpServer({ name: 'comfyui-mcp-runner', version: '0.4.0' });
  server.tool('check_comfyui_health', {}, async () => { await healthCheck(); return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }) }] }; });
  server.tool('inspect_comfyui_workflow', { workflow_name: z.string().min(1) }, async ({ workflow_name }) => { const { workflowPath, workflow } = await readWorkflow(workflowsDir, workflow_name); return { content: [{ type: 'text', text: JSON.stringify({ workflow_file_path: workflowPath, ...inspectWorkflow(workflow) }, null, 2) }] }; });
  server.tool('suggest_workflow_mapping', { workflow_name: z.string().min(1), target_type: z.enum(['image','video','generic']).optional() }, async ({ workflow_name, target_type }) => { const { workflow } = await readWorkflow(workflowsDir, workflow_name); const inspected = inspectWorkflow(workflow); const suggested = suggestMapping(workflow_name, inspected, target_type ?? 'generic'); return { content: [{ type: 'text', text: JSON.stringify(suggested, null, 2) }] }; });
  server.tool('create_preset_from_workflow', { workflow_name: z.string().min(1), preset_name: z.string().min(1), description: z.string().optional(), target_type: z.enum(['image','video','generic']).optional(), confirm: z.boolean() }, async ({ workflow_name, preset_name, description, target_type, confirm }) => {
    const safeName = sanitizePresetName(preset_name);
    const { workflow } = await readWorkflow(workflowsDir, workflow_name);
    const suggested = suggestMapping(workflow_name, inspectWorkflow(workflow), target_type ?? 'generic');
    const preset: PresetFile = { preset_name: safeName, workflow_name, target_type: target_type ?? 'generic', description, mapping: suggested.mapping, notes: suggested.warnings };
    const presetPath = path.resolve(presetsDir, `${safeName}.json`); assertInside(presetsDir, presetPath);
    if (!confirm) return { content: [{ type: 'text', text: JSON.stringify({ status: 'dry_run', preset_path: presetPath, preset_preview: preset }, null, 2) }] };
    try { await fs.access(presetPath); throw new Error(friendlyError('Preset file already exists.', `File exists at ${presetPath}.`, 'Use a different preset_name.')); } catch {}
    await fs.writeFile(presetPath, `${JSON.stringify(preset, null, 2)}\n`, 'utf8');
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'created', preset_path: presetPath, preset }, null, 2) }] };
  });
  server.tool('list_recent_outputs', { limit: z.number().int().positive().max(100).optional(), type: z.enum(['image','video','all']).optional() }, async ({ limit, type }) => {
    let items: JsonObject[] = []; try { const parsed = JSON.parse(await fs.readFile(outputsIndexFile, 'utf8')) as JsonObject[]; items = Array.isArray(parsed) ? parsed : []; } catch {}
    const t = type ?? 'all'; const filtered = t === 'all' ? items : items.filter((it) => Array.isArray(it.output_types) && (it.output_types as unknown[]).includes(t));
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', outputs: filtered.slice(0, limit ?? 10) }, null, 2) }] };
  });

  server.tool('run_comfyui_workflow', runToolSchema, async (input: RunInput) => {
    const runId = randomUUID(); const started = Date.now(); const logFile = path.join(logsDir, `${runId}.log`);
    await runLog(runId, { workflow_name: input.workflow_name, input_parameters: { ...input, positive_prompt: input.positive_prompt.slice(0, 160) } });
    try {
      await healthCheck();
      const { workflow } = await readWorkflow(workflowsDir, input.workflow_name);
      let mapping = config.workflow_mappings[input.workflow_name];
      if (input.preset_name) {
        const presetPath = path.resolve(presetsDir, `${sanitizePresetName(input.preset_name)}.json`); assertInside(presetsDir, presetPath);
        let presetRaw = ''; try { presetRaw = await fs.readFile(presetPath, 'utf8'); } catch { throw new Error(friendlyError('Preset file not found.', `No preset at ${presetPath}.`, 'Create it with create_preset_from_workflow or correct preset_name.')); }
        const preset = JSON.parse(presetRaw) as PresetFile;
        if (preset.workflow_name !== input.workflow_name) throw new Error(friendlyError('Preset references missing workflow.', `Preset workflow '${preset.workflow_name}' != requested '${input.workflow_name}'.`, 'Use matching workflow_name or regenerate preset.'));
        mapping = preset.mapping;
      }
      if (!mapping) throw new Error(friendlyError('Missing workflow mapping.', `No mapping found for '${input.workflow_name}'.`, 'Add config.workflow_mappings entry or use create_preset_from_workflow.'));
      applyWorkflowMappings(workflow, mapping, input);
      const timeoutMs = Math.floor(config.default_timeout_seconds * 1000);
      const submit = await fetchWithTimeout(`${config.comfyui_url}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow }) }, timeoutMs);
      if (!submit.ok) throw new Error(friendlyError('ComfyUI prompt submission failed.', `HTTP ${submit.status} ${submit.statusText}.`, 'Check ComfyUI logs and workflow validity.'));
      const body = (await submit.json()) as { prompt_id?: string; error?: string }; if (!body.prompt_id) throw new Error(friendlyError('ComfyUI did not return prompt_id.', body.error ?? 'Unknown API response', 'Check ComfyUI /prompt response and workflow format.'));
      const promptId = body.prompt_id;
      if (input.wait === false) { await runLog(runId, { prompt_id: promptId, final_status: 'queued' }); return { content: [{ type: 'text', text: JSON.stringify({ status: 'queued', prompt_id: promptId, output_paths: [] }, null, 2) }] }; }
      while (Date.now() - started < timeoutMs) {
        const hist = await fetchWithTimeout(`${config.comfyui_url}/history/${promptId}`, { method: 'GET' }, timeoutMs);
        if (hist.ok) {
          const raw = (await hist.json()) as JsonObject;
          if (raw[promptId]) {
            const ext = extractOutputPaths(raw, promptId);
            if (!ext.files.length) throw new Error(friendlyError('No output files detected.', 'ComfyUI history entry has no image/video/audio file outputs.', 'Check workflow output nodes and ComfyUI output settings.'));
            const duration = Number(((Date.now() - started) / 1000).toFixed(3));
            await runLog(runId, { prompt_id: promptId, final_status: 'completed', output_paths: ext.files });
            await addOutputIndex({ timestamp: nowIso(), workflow_name: input.workflow_name, preset_name: input.preset_name, prompt_id: promptId, positive_prompt_summary: input.positive_prompt.slice(0, 160), seed: input.seed, output_files: ext.files, output_types: ext.types, duration_seconds: duration, log_file_path: logFile });
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'completed', prompt_id: promptId, output_paths: ext.files }, null, 2) }] };
          }
        }
        await new Promise((r) => setTimeout(r, Math.floor(config.polling_interval_seconds * 1000)));
      }
      throw new Error(friendlyError('ComfyUI job timed out.', `Polling exceeded ${config.default_timeout_seconds} seconds.`, 'Increase timeout or simplify workflow.'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await runLog(runId, { final_status: 'failed', error: message });
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'failed', error: message }, null, 2) }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error) => { console.error(error); process.exit(1); });
