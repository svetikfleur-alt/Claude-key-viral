export type JsonObject = Record<string, unknown>;
export type Confidence = 'high' | 'medium' | 'low';

export interface FieldMapping { node_id: string; path: string[]; }

export interface WorkflowMapping {
  positive_prompt?: FieldMapping;
  negative_prompt?: FieldMapping;
  seed?: FieldMapping;
  width?: FieldMapping;
  height?: FieldMapping;
  extra_params?: Record<string, FieldMapping>;
}

export interface PresetFile {
  preset_name: string;
  workflow_name: string;
  target_type: 'image' | 'video' | 'generic';
  description?: string;
  mapping: WorkflowMapping;
  notes?: string[];
}

export interface AppConfig {
  comfyui_url: string;
  workflows_dir: string;
  logs_dir: string;
  default_timeout_seconds: number;
  polling_interval_seconds: number;
  workflow_mappings: Record<string, WorkflowMapping>;
  presets_dir?: string;
  outputs_index_file?: string;
}

export interface RunInput {
  workflow_name: string;
  positive_prompt: string;
  negative_prompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  wait?: boolean;
  preset_name?: string;
  extra_params?: Record<string, unknown>;
}
