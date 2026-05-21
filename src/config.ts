import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppConfig, ResolvedConfig } from './types.js';

const fieldMappingSchema = z.object({
  node_id: z.string().min(1),
  field_path: z.array(z.string().min(1)).min(1),
});

const workflowMappingsSchema = z.object({
  positive_prompt: fieldMappingSchema.optional(),
  negative_prompt: fieldMappingSchema.optional(),
  seed: fieldMappingSchema.optional(),
  width: fieldMappingSchema.optional(),
  height: fieldMappingSchema.optional(),
  extra_params: z.record(fieldMappingSchema).optional(),
});

const workflowEntrySchema = z.object({
  file: z.string().min(1),
  description: z.string().optional(),
  mappings: workflowMappingsSchema,
  comfyui_url_override: z.string().url().optional(),
  default_inputs: z.record(z.unknown()).optional(),
});

const appConfigSchema = z.object({
  comfyui_url: z.string().url().default('http://127.0.0.1:8188'),
  workflows_dir: z.string().min(1).default('./workflows'),
  logs_dir: z.string().min(1).default('./logs'),
  generated_media_dir: z.string().min(1).default('./generated-media'),
  outputs_index_file: z.string().min(1).default('./logs/output-index.json'),
  request_timeout_seconds: z.number().positive().default(30),
  polling_interval_seconds: z.number().positive().default(2),
  polling_timeout_seconds: z.number().positive().default(300),
  workflows: z.record(workflowEntrySchema).default({}),
});

export function assertInside(base: string, target: string): void {
  if (!(target === base || target.startsWith(base + path.sep))) {
    throw new Error(`Path safety error. Cause: resolved path escapes '${base}'. Suggested fix: keep config paths inside the repository workspace.`);
  }
}

export function sanitizeWorkflowName(workflowName: string): string {
  const normalized = workflowName.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Invalid workflow name. Cause: '${workflowName}' contains unsupported characters. Suggested fix: use letters, numbers, dot, dash, or underscore only.`);
  }
  return normalized;
}

export async function loadConfig(projectRoot: string): Promise<ResolvedConfig> {
  const configPath = path.join(projectRoot, 'config.json');
  const fallbackPath = path.join(projectRoot, 'config.example.json');
  const sourcePath = await fs.access(configPath).then(() => configPath).catch(() => fallbackPath);
  const raw = await fs.readFile(sourcePath, 'utf8');
  const parsed = appConfigSchema.safeParse(JSON.parse(raw));

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid config file. Cause: ${details}. Suggested fix: compare config.json to config.example.json and correct the field types.`);
  }

  const config = parsed.data as AppConfig;
  const workflowsDirAbs = path.resolve(projectRoot, config.workflows_dir);
  const logsDirAbs = path.resolve(projectRoot, config.logs_dir);
  const generatedMediaDirAbs = path.resolve(projectRoot, config.generated_media_dir);
  const outputsIndexAbs = path.resolve(projectRoot, config.outputs_index_file);

  assertInside(projectRoot, workflowsDirAbs);
  assertInside(projectRoot, logsDirAbs);
  assertInside(projectRoot, generatedMediaDirAbs);
  assertInside(logsDirAbs, outputsIndexAbs);

  for (const [workflowName, entry] of Object.entries(config.workflows)) {
    sanitizeWorkflowName(workflowName);
    const workflowPath = path.resolve(workflowsDirAbs, entry.file);
    assertInside(workflowsDirAbs, workflowPath);
  }

  await fs.mkdir(workflowsDirAbs, { recursive: true });
  await fs.mkdir(logsDirAbs, { recursive: true });
  await fs.mkdir(generatedMediaDirAbs, { recursive: true });

  return {
    ...config,
    project_root: projectRoot,
    config_path: sourcePath,
    workflows_dir_abs: workflowsDirAbs,
    logs_dir_abs: logsDirAbs,
    generated_media_dir_abs: generatedMediaDirAbs,
    outputs_index_file_abs: outputsIndexAbs,
  };
}
