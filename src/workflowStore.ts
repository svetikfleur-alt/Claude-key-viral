import fs from 'node:fs/promises';
import path from 'node:path';
import { assertInside, sanitizeWorkflowName } from './config.js';
import type {
  JsonObject,
  ResolvedConfig,
  WorkflowConfigListing,
  WorkflowFileListing,
  WorkflowLoadResult,
} from './types.js';

export async function listConfiguredWorkflows(config: ResolvedConfig): Promise<WorkflowConfigListing[]> {
  return Object.entries(config.workflows).map(([workflowName, entry]) => ({
    workflow_name: workflowName,
    file: entry.file,
    description: entry.description,
    has_mapping: Object.keys(entry.mappings).length > 0,
  }));
}

export async function listWorkflowFiles(config: ResolvedConfig): Promise<WorkflowFileListing[]> {
  const entries = await fs.readdir(config.workflows_dir_abs, { withFileTypes: true }).catch(() => []);
  const configuredFiles = new Map(Object.entries(config.workflows).map(([name, entry]) => [entry.file, name]));

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => ({
      file: entry.name,
      detected_workflow_name: configuredFiles.get(entry.name) ?? path.basename(entry.name, '.json'),
      configured: configuredFiles.has(entry.name),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function resolveWorkflowPath(config: ResolvedConfig, workflowName: string): { fileName: string; configuredEntry?: ResolvedConfig['workflows'][string] } {
  const normalizedName = sanitizeWorkflowName(workflowName);
  const configuredEntry = config.workflows[normalizedName];
  const fileName = configuredEntry?.file ?? `${normalizedName}.json`;
  const workflowPath = path.resolve(config.workflows_dir_abs, fileName);
  assertInside(config.workflows_dir_abs, workflowPath);
  return { fileName, configuredEntry };
}

export async function loadWorkflow(config: ResolvedConfig, workflowName: string): Promise<WorkflowLoadResult> {
  const { fileName, configuredEntry } = resolveWorkflowPath(config, workflowName);
  const workflowPath = path.resolve(config.workflows_dir_abs, fileName);

  let raw = '';
  try {
    raw = await fs.readFile(workflowPath, 'utf8');
  } catch {
    throw new Error(`Workflow file not found. Cause: '${fileName}' does not exist in ${config.workflows_dir}. Suggested fix: export the workflow JSON into workflows_dir or correct config.json.`);
  }

  let workflow: JsonObject;
  try {
    workflow = JSON.parse(raw) as JsonObject;
  } catch {
    throw new Error(`Invalid workflow JSON. Cause: '${fileName}' could not be parsed. Suggested fix: export a valid API JSON workflow from ComfyUI.`);
  }

  return {
    workflow_name: sanitizeWorkflowName(workflowName),
    workflow_file: fileName,
    workflow_path: workflowPath,
    workflow,
    configured_entry: configuredEntry,
  };
}
