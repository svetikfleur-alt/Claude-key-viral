import type {
  JsonObject,
  ResolvedConfig,
  RunInput,
  WorkflowConfigEntry,
  WorkflowLoadResult,
} from './types.js';
import { ComfyUiClient } from './comfyuiClient.js';

export interface ComfyRuntimeInventory {
  comfyui_url: string;
  checkpoint_names: string[];
  unet_names: string[];
  text_encoder_names: string[];
  vae_names: string[];
  lora_names: string[];
}

export interface PreparedWorkflowRun {
  input: RunInput;
  warnings: string[];
  inventory: ComfyRuntimeInventory;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length > 0);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function extractRequiredOptions(objectInfo: JsonObject, nodeName: string, fieldName: string): string[] {
  const node = objectInfo[nodeName];
  if (!isRecord(node)) return [];
  const input = node.input;
  if (!isRecord(input)) return [];
  const required = input.required;
  if (!isRecord(required)) return [];
  const rawField = required[fieldName];
  if (!Array.isArray(rawField)) return [];
  return uniqueSorted(stringList(rawField[0]));
}

function workflowUsesClassType(workflow: JsonObject, classType: string): boolean {
  return Object.values(workflow).some((node) => (
    isRecord(node) && String(node.class_type ?? '') === classType
  ));
}

function extractCheckpointNamesFromWorkflow(workflow: JsonObject): string[] {
  const names: string[] = [];
  for (const node of Object.values(workflow)) {
    if (!isRecord(node) || String(node.class_type ?? '') !== 'CheckpointLoaderSimple') continue;
    const inputs = node.inputs;
    if (!isRecord(inputs)) continue;
    const ckptName = asOptionalString(inputs.ckpt_name);
    if (ckptName) names.push(ckptName);
  }
  return uniqueSorted(names);
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function applyWorkflowDefaults(input: RunInput, configuredEntry?: WorkflowConfigEntry): RunInput {
  const defaults = configuredEntry?.default_inputs;
  const defaultExtraParams = isRecord(defaults?.extra_params) ? defaults.extra_params : {};
  return {
    workflow_name: input.workflow_name,
    positive_prompt: input.positive_prompt,
    negative_prompt: input.negative_prompt ?? asOptionalString(defaults?.negative_prompt),
    seed: input.seed ?? asOptionalNumber(defaults?.seed),
    width: input.width ?? asOptionalNumber(defaults?.width),
    height: input.height ?? asOptionalNumber(defaults?.height),
    extra_params: {
      ...defaultExtraParams,
      ...(input.extra_params ?? {}),
    },
  };
}

export async function getComfyRuntimeInventory(
  client: ComfyUiClient,
  comfyuiUrl: string,
): Promise<ComfyRuntimeInventory> {
  const objectInfo = await client.getObjectInfo(comfyuiUrl);
  return {
    comfyui_url: comfyuiUrl,
    checkpoint_names: extractRequiredOptions(objectInfo, 'CheckpointLoaderSimple', 'ckpt_name'),
    unet_names: extractRequiredOptions(objectInfo, 'UNETLoader', 'unet_name'),
    text_encoder_names: extractRequiredOptions(objectInfo, 'CLIPLoader', 'clip_name'),
    vae_names: extractRequiredOptions(objectInfo, 'VAELoader', 'vae_name'),
    lora_names: extractRequiredOptions(objectInfo, 'LoraLoader', 'lora_name'),
  };
}

function isPlaceholderCheckpointName(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0
    || normalized === '__set_checkpoint__'
    || normalized === 'your-checkpoint-name.safetensors'
    || normalized === 'your_checkpoint_name.safetensors'
    || normalized === 'your-checkpoint-name.ckpt'
    || normalized === 'your_checkpoint_name.ckpt';
}

function matchesOption(options: string[], needle: string): boolean {
  const normalizedNeedle = needle.trim().toLowerCase();
  return options.some((option) => option.trim().toLowerCase() === normalizedNeedle);
}

function containsNeedle(options: string[], needle: string): boolean {
  const normalizedNeedle = needle.trim().toLowerCase();
  return options.some((option) => option.trim().toLowerCase().includes(normalizedNeedle));
}

function summarizeOptions(options: string[]): string {
  if (options.length === 0) return '(none detected)';
  const shown = options.slice(0, 8);
  return shown.join(', ') + (options.length > shown.length ? ` ... (+${options.length - shown.length} more)` : '');
}

function ensureCheckpointReady(
  config: ResolvedConfig,
  workflow: JsonObject,
  prepared: RunInput,
  inventory: ComfyRuntimeInventory,
  warnings: string[],
): void {
  const currentExtraParams = { ...(prepared.extra_params ?? {}) };
  const workflowCheckpointNames = extractCheckpointNamesFromWorkflow(workflow);
  const requested = asOptionalString(currentExtraParams.checkpoint_name) ?? workflowCheckpointNames[0];
  if (inventory.checkpoint_names.length === 0) {
    throw new Error(
      `True txt2img nature generation is blocked. Cause: ComfyUI reports zero checkpoints in CheckpointLoaderSimple at ${inventory.comfyui_url}. ` +
      `Suggested fix: place a .safetensors/.ckpt file in ComfyUI/models/checkpoints (for this machine: C:\\Users\\Lena\\Documents\\ComfyUI\\models\\checkpoints), restart ComfyUI, and confirm it appears in /object_info.`,
    );
  }

  if (isPlaceholderCheckpointName(requested)) {
    if (inventory.checkpoint_names.length === 1) {
      currentExtraParams.checkpoint_name = inventory.checkpoint_names[0];
      prepared.extra_params = currentExtraParams;
      warnings.push(`Auto-selected the only available checkpoint: ${inventory.checkpoint_names[0]}.`);
      return;
    }
    throw new Error(
      `Checkpoint selection is required before this workflow can run. Cause: config still has a placeholder checkpoint name and ComfyUI exposes multiple checkpoints. ` +
      `Suggested fix: set extra_params.checkpoint_name to one of: ${summarizeOptions(inventory.checkpoint_names)}.`,
    );
  }

  const requestedCheckpoint = requested ?? '';
  if (!matchesOption(inventory.checkpoint_names, requestedCheckpoint)) {
    throw new Error(
      `Requested checkpoint '${requestedCheckpoint}' is not visible to ComfyUI. Cause: CheckpointLoaderSimple does not list it in /object_info. ` +
      `Suggested fix: use one of the detected checkpoints (${summarizeOptions(inventory.checkpoint_names)}) or move the model into C:\\Users\\Lena\\Documents\\ComfyUI\\models\\checkpoints and restart ComfyUI.`,
    );
  }

  if (!asOptionalString(currentExtraParams.checkpoint_name)) {
    currentExtraParams.checkpoint_name = requestedCheckpoint;
    prepared.extra_params = currentExtraParams;
    if (workflowCheckpointNames.some((name) => name === requestedCheckpoint)) {
      warnings.push(`Using checkpoint from workflow JSON: ${requestedCheckpoint}.`);
    }
  }

  if (!config.comfyui_output_dir_abs) {
    warnings.push('config.comfyui_output_dir is not set; output path resolution may be incomplete.');
  }
}

function ensureQwenReady(prepared: RunInput, inventory: ComfyRuntimeInventory, warnings: string[]): void {
  const missing: string[] = [];
  if (!containsNeedle(inventory.unet_names, 'qwen_image_edit')) missing.push('Qwen UNET');
  if (!containsNeedle(inventory.text_encoder_names, 'qwen_2.5_vl')) missing.push('Qwen text encoder');
  if (!containsNeedle(inventory.vae_names, 'qwen_image_vae')) missing.push('Qwen VAE');
  if (!containsNeedle(inventory.lora_names, 'qwen-image-edit-2509-lightning')) missing.push('Qwen Lightning LoRA');
  if (missing.length > 0) {
    throw new Error(
      `Qwen image generation is not ready. Cause: ComfyUI is missing required assets (${missing.join(', ')}). ` +
      `Suggested fix: verify the Qwen model files are present in ComfyUI/models/* and visible in /object_info before retrying.`,
    );
  }

  const width = prepared.width ?? asOptionalNumber(prepared.extra_params?.width);
  const height = prepared.height ?? asOptionalNumber(prepared.extra_params?.height);
  if (typeof width === 'number' && typeof height === 'number' && width * height > 1024 * 1024) {
    warnings.push('Large Qwen canvas detected; reduce width/height if the local CPU runtime crashes under memory pressure.');
  }
  warnings.push('Qwen blank-canvas/image-edit workflows on CPU-only ComfyUI may still crash under low-memory conditions; a classic checkpoint txt2img path is the more stable nature-image route once a checkpoint is installed.');
}

export async function prepareWorkflowRun(
  config: ResolvedConfig,
  client: ComfyUiClient,
  loaded: WorkflowLoadResult,
  input: RunInput,
  comfyuiUrl: string,
): Promise<PreparedWorkflowRun> {
  const prepared = applyWorkflowDefaults(input, loaded.configured_entry);
  const inventory = await getComfyRuntimeInventory(client, comfyuiUrl);
  const warnings: string[] = [];

  if (workflowUsesClassType(loaded.workflow, 'CheckpointLoaderSimple')) {
    ensureCheckpointReady(config, loaded.workflow, prepared, inventory, warnings);
  }

  if (loaded.workflow_name === 'qwen-image-edit-pro' || loaded.workflow_name === 'qwen-image-from-blank') {
    ensureQwenReady(prepared, inventory, warnings);
  }

  return { input: prepared, warnings, inventory };
}

export function evaluateNatureReadiness(inventory: ComfyRuntimeInventory): {
  status: 'ready' | 'blocked';
  preferred_workflow: 'checkpoint-text2img-nature' | 'qwen-image-from-blank';
  message: string;
} {
  if (inventory.checkpoint_names.length > 0) {
    return {
      status: 'ready',
      preferred_workflow: 'checkpoint-text2img-nature',
      message: `Checkpoint-based txt2img is ready. Detected checkpoints: ${summarizeOptions(inventory.checkpoint_names)}.`,
    };
  }

  const hasQwen = containsNeedle(inventory.unet_names, 'qwen_image_edit')
    && containsNeedle(inventory.text_encoder_names, 'qwen_2.5_vl')
    && containsNeedle(inventory.vae_names, 'qwen_image_vae');
  if (hasQwen) {
    return {
      status: 'blocked',
      preferred_workflow: 'qwen-image-from-blank',
      message: 'Only the Qwen edit stack is visible. A blank-canvas workaround exists, but this machine has been crashing during real runs; install a classic checkpoint for a stable true nature txt2img path.',
    };
  }

  return {
    status: 'blocked',
    preferred_workflow: 'checkpoint-text2img-nature',
    message: 'No classic checkpoints and no complete Qwen image stack are visible, so true local nature generation is not ready yet.',
  };
}
