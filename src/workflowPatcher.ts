import type {
  Confidence,
  DryRunResult,
  FieldMapping,
  JsonObject,
  PatchedFieldChange,
  RunInput,
  WorkflowInspection,
  WorkflowMappings,
  WorkflowNodeRole,
} from './types.js';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getNodeTitle(node: JsonObject): string | undefined {
  const meta = node._meta;
  return meta && typeof meta === 'object' && typeof (meta as JsonObject).title === 'string'
    ? String((meta as JsonObject).title)
    : undefined;
}

function detectNodeRoles(nodeId: string, node: JsonObject): WorkflowNodeRole[] {
  const classType = String(node.class_type ?? '').toLowerCase();
  const title = String(getNodeTitle(node) ?? '').toLowerCase();
  const inputs = node.inputs && typeof node.inputs === 'object' ? node.inputs as JsonObject : {};
  const inputKeys = Object.keys(inputs).join(' ').toLowerCase();
  const textValue = typeof inputs.text === 'string' ? inputs.text.toLowerCase() : '';
  const haystack = `${classType} ${title} ${inputKeys} ${textValue}`;
  const roles: WorkflowNodeRole[] = [];
  const mark = (role: string, confidence: Confidence) => roles.push({ role, confidence });

  const isPromptNode = classType.includes('cliptextencode') || (inputKeys.includes('text') && /prompt|text/.test(`${classType} ${title}`));
  if (isPromptNode && /negative/.test(`${title} ${textValue}`)) mark('negative prompt node', 'high');
  if (isPromptNode && !/negative/.test(`${title} ${textValue}`)) mark('positive prompt node', classType.includes('cliptextencode') ? 'high' : 'medium');
  if (/seed/.test(haystack)) mark('seed node', 'high');
  if (/width/.test(haystack)) mark('width node', 'medium');
  if (/height/.test(haystack)) mark('height node', 'medium');
  if (/saveimage|image/.test(classType) && !/loadimage/.test(classType)) mark('output image node', classType.includes('saveimage') ? 'high' : 'low');
  if (/video|videocombine|saveanimated/.test(haystack)) mark('output video node', 'medium');
  if (/ksampler|sampler/.test(haystack)) mark('sampler node', 'high');
  if (/checkpoint|model|ckptloader/.test(haystack)) mark('model node', 'medium');
  if (roles.length === 0) mark(`unknown:${nodeId}`, 'low');
  return roles;
}

export function inspectWorkflow(workflowName: string, workflowFile: string, workflow: JsonObject): WorkflowInspection {
  const nodes = Object.entries(workflow)
    .filter(([, value]) => value && typeof value === 'object')
    .map(([nodeId, value]) => {
      const node = value as JsonObject;
      const inputs = node.inputs && typeof node.inputs === 'object' ? Object.keys(node.inputs as JsonObject) : [];
      return {
        node_id: nodeId,
        class_type: String(node.class_type ?? 'unknown'),
        input_keys: inputs,
        likely_roles: detectNodeRoles(nodeId, node),
      };
    });

  return {
    workflow_name: workflowName,
    workflow_file: workflowFile,
    node_count: nodes.length,
    nodes,
  };
}

function getValueAtPath(root: unknown, fieldPath: string[]): unknown {
  let current = root;
  for (const segment of fieldPath) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new Error(`Missing field path. Cause: '${fieldPath.join('.')}' was not found. Suggested fix: inspect the workflow JSON and correct the mapping path.`);
    }
    current = (current as JsonObject)[segment];
  }
  return current;
}

function setValueAtPath(root: unknown, fieldPath: string[], value: unknown): void {
  let current = root;
  for (let index = 0; index < fieldPath.length - 1; index += 1) {
    const segment = fieldPath[index];
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new Error(`Missing field path. Cause: '${fieldPath.join('.')}' was not found. Suggested fix: inspect the workflow JSON and correct the mapping path.`);
    }
    current = (current as JsonObject)[segment];
  }

  const finalKey = fieldPath[fieldPath.length - 1];
  if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, finalKey)) {
    throw new Error(`Missing field path. Cause: '${fieldPath.join('.')}' was not found. Suggested fix: inspect the workflow JSON and correct the mapping path.`);
  }
  (current as JsonObject)[finalKey] = value;
}

function patchMappedField(workflowName: string, workflow: JsonObject, inputName: string, mapping: FieldMapping, nextValue: unknown): PatchedFieldChange {
  const node = workflow[mapping.node_id];
  if (!node || typeof node !== 'object') {
    throw new Error(`Mapping for ${inputName} points to node ${mapping.node_id}, but node ${mapping.node_id} was not found in workflow ${workflowName}.`);
  }

  const previousValue = getValueAtPath(node, mapping.field_path);
  setValueAtPath(node, mapping.field_path, nextValue);

  return {
    input_name: inputName,
    node_id: mapping.node_id,
    field_path: [...mapping.field_path],
    previous_value: previousValue,
    next_value: nextValue,
  };
}

export function dryRunPatchWorkflow(
  workflowName: string,
  workflow: JsonObject,
  mappings: WorkflowMappings | undefined,
  input: RunInput,
): DryRunResult {
  const workflowCopy = cloneJson(workflow);
  const warnings: string[] = [];
  const changedNodes: PatchedFieldChange[] = [];
  const finalMappedParameters: Record<string, unknown> = {};

  if (!mappings) {
    return {
      changed_nodes: [],
      final_mapped_parameters: {},
      warnings: [`No workflow mapping found for '${workflowName}'.`],
      ready_to_run: false,
    };
  }

  const applyIfProvided = (inputName: keyof RunInput, mapping?: FieldMapping) => {
    const value = input[inputName];
    if (value === undefined) return;
    finalMappedParameters[String(inputName)] = value;
    if (!mapping) {
      warnings.push(`No mapping configured for '${String(inputName)}'.`);
      return;
    }
    changedNodes.push(patchMappedField(workflowName, workflowCopy, String(inputName), mapping, value));
  };

  applyIfProvided('positive_prompt', mappings.positive_prompt);
  applyIfProvided('negative_prompt', mappings.negative_prompt);
  applyIfProvided('seed', mappings.seed);
  applyIfProvided('width', mappings.width);
  applyIfProvided('height', mappings.height);

  for (const [key, value] of Object.entries(input.extra_params ?? {})) {
    finalMappedParameters[`extra_params.${key}`] = value;
    const mapping = mappings.extra_params?.[key];
    if (!mapping) {
      warnings.push(`No mapping configured for extra_params.${key}.`);
      continue;
    }
    changedNodes.push(patchMappedField(workflowName, workflowCopy, `extra_params.${key}`, mapping, value));
  }

  return {
    changed_nodes: changedNodes,
    final_mapped_parameters: finalMappedParameters,
    warnings,
    ready_to_run: warnings.length === 0,
  };
}

export function patchWorkflowForRun(
  workflowName: string,
  workflow: JsonObject,
  mappings: WorkflowMappings | undefined,
  input: RunInput,
): { workflow: JsonObject; changes: PatchedFieldChange[]; warnings: string[] } {
  const result = dryRunPatchWorkflow(workflowName, workflow, mappings, input);
  const workflowCopy = cloneJson(workflow);

  if (!mappings) {
    // Allow workflows that already have baked-in values to run unchanged.
    return {
      workflow: workflowCopy,
      changes: [],
      warnings: result.warnings,
    };
  }

  const changes = result.changed_nodes.map((change) => patchMappedField(workflowName, workflowCopy, change.input_name, {
    node_id: change.node_id,
    field_path: change.field_path,
  }, change.next_value));

  return { workflow: workflowCopy, changes, warnings: result.warnings };
}
