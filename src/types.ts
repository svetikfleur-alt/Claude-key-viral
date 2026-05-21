export type JsonObject = Record<string, unknown>;
export type Confidence = 'high' | 'medium' | 'low';
export type OutputGroup = 'image' | 'video' | 'other';

export interface FieldMapping {
  node_id: string;
  field_path: string[];
}

export interface WorkflowMappings {
  positive_prompt?: FieldMapping;
  negative_prompt?: FieldMapping;
  seed?: FieldMapping;
  width?: FieldMapping;
  height?: FieldMapping;
  extra_params?: Record<string, FieldMapping>;
}

export interface WorkflowConfigEntry {
  file: string;
  description?: string;
  mappings: WorkflowMappings;
  comfyui_url_override?: string;
  default_inputs?: Record<string, unknown>;
}

export interface AppConfig {
  comfyui_url: string;
  workflows_dir: string;
  logs_dir: string;
  generated_media_dir: string;
  outputs_index_file: string;
  request_timeout_seconds: number;
  polling_interval_seconds: number;
  polling_timeout_seconds: number;
  workflows: Record<string, WorkflowConfigEntry>;
}

export interface ResolvedConfig extends AppConfig {
  project_root: string;
  config_path: string;
  workflows_dir_abs: string;
  logs_dir_abs: string;
  generated_media_dir_abs: string;
  outputs_index_file_abs: string;
}

export interface WorkflowNodeRole {
  role: string;
  confidence: Confidence;
}

export interface WorkflowNodeSummary {
  node_id: string;
  class_type: string;
  input_keys: string[];
  likely_roles: WorkflowNodeRole[];
}

export interface WorkflowInspection {
  workflow_name: string;
  workflow_file: string;
  node_count: number;
  nodes: WorkflowNodeSummary[];
}

export interface WorkflowLoadResult {
  workflow_name: string;
  workflow_file: string;
  workflow_path: string;
  workflow: JsonObject;
  configured_entry?: WorkflowConfigEntry;
}

export interface WorkflowFileListing {
  file: string;
  detected_workflow_name: string;
  configured: boolean;
}

export interface WorkflowConfigListing {
  workflow_name: string;
  file: string;
  description?: string;
  has_mapping: boolean;
}

export interface PatchedFieldChange {
  input_name: string;
  node_id: string;
  field_path: string[];
  previous_value: unknown;
  next_value: unknown;
}

export interface RunInput {
  workflow_name: string;
  positive_prompt: string;
  negative_prompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  extra_params?: Record<string, unknown>;
}

export interface DryRunResult {
  changed_nodes: PatchedFieldChange[];
  final_mapped_parameters: Record<string, unknown>;
  warnings: string[];
  ready_to_run: boolean;
}

export interface ComfyHealthResult {
  reachable: boolean;
  status: 'ok' | 'unreachable';
  comfyui_url: string;
  message: string;
}

export interface ComfyQueueResult {
  prompt_id: string;
  raw_response: JsonObject;
}

export interface OutputFileRecord {
  type: OutputGroup;
  path: string;
  filename?: string;
  subfolder?: string;
  format?: string;
  source_node_id?: string;
  raw?: JsonObject;
}

export interface OutputDetectionResult {
  images: OutputFileRecord[];
  videos: OutputFileRecord[];
  other: OutputFileRecord[];
  warnings: string[];
}

export interface RunLogEntry {
  timestamp: string;
  workflow_name: string;
  prompt_id?: string;
  comfyui_url?: string;
  prompt_json?: JsonObject;
  input_parameters: Record<string, unknown>;
  duration_seconds?: number;
  status: 'queued' | 'completed' | 'failed';
  outputs?: OutputDetectionResult;
  warnings?: string[];
  error?: string;
}

export interface OutputIndexEntry {
  timestamp: string;
  workflow_name: string;
  prompt_id: string;
  duration_seconds: number;
  outputs: OutputDetectionResult;
  log_file: string;
}

export interface SvgTemplateInput {
  template: 'github_hero_banner' | 'pipeline_diagram' | 'social_launch_card' | 'feature_card';
  title: string;
  subtitle?: string;
  bullets?: string[];
  width?: number;
  height?: number;
  output_name?: string;
}

export interface SvgMarkupInput {
  svg_markup: string;
  output_name?: string;
}

export type SvgSceneTextAlign = 'left' | 'center' | 'right';
export type SvgSceneDirection = 'vertical' | 'horizontal';

export interface SvgSceneGradientStop {
  offset: string;
  color: string;
  opacity?: number;
}

export interface SvgSceneLinearGradientDef {
  id: string;
  type: 'linear';
  x1?: string;
  y1?: string;
  x2?: string;
  y2?: string;
  stops: SvgSceneGradientStop[];
}

export interface SvgSceneRadialGradientDef {
  id: string;
  type: 'radial';
  cx?: string;
  cy?: string;
  r?: string;
  fx?: string;
  fy?: string;
  stops: SvgSceneGradientStop[];
}

export interface SvgSceneDropShadowFilterDef {
  id: string;
  type: 'drop_shadow';
  dx?: number;
  dy?: number;
  std_deviation?: number;
  color?: string;
  opacity?: number;
}

export type SvgSceneGradientDef = SvgSceneLinearGradientDef | SvgSceneRadialGradientDef;
export type SvgSceneFilterDef = SvgSceneDropShadowFilterDef;

export interface SvgSceneRectNode {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  radius?: number;
  opacity?: number;
  filter?: string;
  transform?: string;
}

export interface SvgSceneLineNode {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  stroke_width?: number;
  opacity?: number;
  stroke_linecap?: 'butt' | 'round' | 'square';
  transform?: string;
}

export interface SvgSceneCircleNode {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  opacity?: number;
  filter?: string;
  transform?: string;
}

export interface SvgSceneEllipseNode {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  opacity?: number;
  filter?: string;
  transform?: string;
}

export interface SvgScenePathNode {
  kind: 'path';
  d: string;
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  opacity?: number;
  stroke_linecap?: 'butt' | 'round' | 'square';
  stroke_linejoin?: 'miter' | 'round' | 'bevel';
  filter?: string;
  transform?: string;
}

export interface SvgScenePolygonNode {
  kind: 'polygon';
  points: string | Array<[number, number]>;
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  opacity?: number;
  filter?: string;
  transform?: string;
}

export interface SvgSceneTextNode {
  kind: 'text';
  x: number;
  y: number;
  width?: number;
  text: string;
  font_size: number;
  font_weight?: number;
  font_family?: string;
  font_style?: 'normal' | 'italic';
  text_decoration?: 'none' | 'underline' | 'line-through';
  fill?: string;
  line_height?: number;
  letter_spacing?: number;
  align?: SvgSceneTextAlign;
  opacity?: number;
  filter?: string;
  transform?: string;
}

export interface SvgSceneImageNode {
  kind: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  href: string;
  radius?: number;
  opacity?: number;
  preserve_aspect?: 'cover' | 'contain';
  filter?: string;
  transform?: string;
}

export interface SvgSceneGroupNode {
  kind: 'group';
  x?: number;
  y?: number;
  opacity?: number;
  filter?: string;
  transform?: string;
  children: SvgSceneNode[];
}

export interface SvgSceneStackNode {
  kind: 'stack';
  x: number;
  y: number;
  width: number;
  height?: number;
  direction: SvgSceneDirection;
  gap?: number;
  padding?: number;
  align?: 'start' | 'center' | 'end';
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  radius?: number;
  opacity?: number;
  filter?: string;
  transform?: string;
  children: SvgSceneNode[];
}

export type SvgSceneNode =
  | SvgSceneRectNode
  | SvgSceneLineNode
  | SvgSceneCircleNode
  | SvgSceneEllipseNode
  | SvgScenePathNode
  | SvgScenePolygonNode
  | SvgSceneTextNode
  | SvgSceneImageNode
  | SvgSceneGroupNode
  | SvgSceneStackNode;

export interface SvgSceneSpec {
  width: number;
  height: number;
  background?: string;
  defs?: {
    gradients?: SvgSceneGradientDef[];
    filters?: SvgSceneFilterDef[];
  };
  nodes: SvgSceneNode[];
}

export interface SvgSceneRenderInput {
  scene: SvgSceneSpec;
  output_name?: string;
  rasterize_png?: boolean;
}

export interface SvgSceneRenderResult {
  status: 'ok';
  svg_path: string;
  png_path?: string;
  width: number;
  height: number;
  warnings: string[];
  text_fragments: string[];
}

export interface CodegenSceneInput {
  headline: string;
  body?: string;
  accent?: string;
  media_data_url?: string;
  duration_seconds?: number;
}

export interface SvgVideoSceneInput {
  scene: SvgSceneSpec;
  headline?: string;
  body?: string;
  accent?: string;
  duration_seconds?: number;
}

export interface RemotionVideoInput {
  title: string;
  subtitle?: string;
  theme?: 'sunset' | 'ocean' | 'forest' | 'slate';
  visual_style?: 'presentation' | 'cinematic_robot' | 'pipeline_intro' | 'cinematic_treatment' | 'scene_sequence';
  scenes?: CodegenSceneInput[];
  width?: number;
  height?: number;
  fps?: number;
  duration_seconds?: number;
  output_name?: string;
}

export interface SvgSceneVideoInput {
  title: string;
  subtitle?: string;
  theme?: 'sunset' | 'ocean' | 'forest' | 'slate';
  scenes: SvgVideoSceneInput[];
  width?: number;
  height?: number;
  fps?: number;
  output_name?: string;
}

export interface HtmlCardInput {
  template: 'project_hero_banner' | 'social_launch_card' | 'feature_overview_card' | 'capability_card';
  title: string;
  subtitle: string;
  eyebrow?: string;
  bullets?: string[];
  badges?: string[];
  footer?: string;
  width?: number;
  height?: number;
  output_name?: string;
}

export interface HtmlCardRenderResult {
  status: 'ok';
  template: HtmlCardInput['template'];
  svg_path: string;
  png_path: string;
  width: number;
  height: number;
  warnings: string[];
  text_fragments: string[];
}

export interface MediaAssetRecord {
  id: string;
  category: string;
  renderer: 'html_card' | 'svg_template' | 'scene_graph' | 'remotion_video' | 'manual_note' | 'reference_study';
  title: string;
  status: 'generated' | 'skipped';
  primary_path: string;
  secondary_paths?: string[];
  width?: number;
  height?: number;
  notes?: string[];
}

export interface MediaPipelineRunResult {
  run_id: string;
  run_dir: string;
  manifest_path: string;
  report_path: string;
  index_path: string;
  gallery_path: string;
  assets: MediaAssetRecord[];
  skipped: string[];
}
