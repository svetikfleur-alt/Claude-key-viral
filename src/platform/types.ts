/**
 * Hybrid Media Platform — Core Types
 *
 * Shared type definitions for the platform layer: projects, jobs, assets,
 * routing, and the unified media request model.
 */

// ─── Identifiers ─────────────────────────────────────────────────────────────

export type ProjectId = string;
export type JobId = string;
export type AssetId = string;

// ─── Media Modalities ────────────────────────────────────────────────────────

export type MediaModality =
  | 'text-to-image'
  | 'text-to-video'
  | 'image-to-image'
  | 'image-to-video'
  | 'text-to-audio'
  | 'image-to-3d'
  | 'video-upscale'
  | 'image-upscale'
  | 'inpaint'
  | 'outpaint'
  | 'remove-background'
  | 'code-render'       // SVG / HTML card / Remotion — no AI needed
  | 'scene-graph'       // Scene DSL → SVG/PNG/video
  | 'cinematic-treatment';

// ─── Renderer Backends ───────────────────────────────────────────────────────

export type RendererBackend =
  | 'code-svg'          // svgRenderer / sceneDslRenderer
  | 'code-html-card'    // htmlCardRenderer
  | 'code-remotion'     // remotionRenderer
  | 'comfyui-local'     // local ComfyUI instance
  | 'comfyui-cloud'     // cloud API nodes inside ComfyUI
  | 'auto';             // platform picks the best available backend

// ─── Job Status ──────────────────────────────────────────────────────────────

export type JobStatus =
  | 'queued'
  | 'routing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ─── Asset Types ─────────────────────────────────────────────────────────────

export type AssetMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/svg+xml'
  | 'image/webp'
  | 'video/mp4'
  | 'video/webm'
  | 'audio/mpeg'
  | 'audio/wav'
  | 'model/gltf-binary'
  | 'application/json'
  | 'text/markdown';

export type AssetKind = 'image' | 'video' | 'audio' | 'model-3d' | 'document' | 'svg';

// ─── Project ─────────────────────────────────────────────────────────────────

export interface Project {
  id: ProjectId;
  name: string;
  description?: string;
  tags: string[];
  created_at: string;   // ISO 8601
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  tags?: string[];
}

// ─── Media Job ───────────────────────────────────────────────────────────────

export interface MediaJobRequest {
  /** Human-readable label for this job */
  label?: string;
  /** Which project this job belongs to (optional) */
  project_id?: ProjectId;
  /** What kind of media to generate */
  modality: MediaModality;
  /** Preferred backend — defaults to 'auto' */
  backend?: RendererBackend;
  /** Primary text prompt */
  prompt: string;
  /** Negative prompt (for diffusion models) */
  negative_prompt?: string;
  /** Reference image path or data URL */
  source_image?: string;
  /** Reference video path */
  source_video?: string;
  /** Seed for reproducibility */
  seed?: number;
  /** Output width in pixels */
  width?: number;
  /** Output height in pixels */
  height?: number;
  /** Duration in seconds (video/audio) */
  duration_seconds?: number;
  /** Named ComfyUI workflow to use (overrides auto-routing) */
  workflow_name?: string;
  /** Extra backend-specific parameters */
  extra_params?: Record<string, unknown>;
  /** Tags to attach to generated assets */
  asset_tags?: string[];
}

export interface MediaJob {
  id: JobId;
  label: string;
  project_id?: ProjectId;
  modality: MediaModality;
  backend_used?: RendererBackend;
  workflow_name?: string;
  status: JobStatus;
  request: MediaJobRequest;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  output_asset_ids: AssetId[];
  error?: string;
  warnings: string[];
  run_dir?: string;
  prompt_id?: string;   // ComfyUI prompt ID if applicable
}

// ─── Asset ───────────────────────────────────────────────────────────────────

export interface MediaAsset {
  id: AssetId;
  job_id?: JobId;
  project_id?: ProjectId;
  kind: AssetKind;
  mime_type: AssetMimeType;
  filename: string;
  /** Absolute path on disk */
  path: string;
  /** Path relative to project root for portability */
  relative_path: string;
  title?: string;
  tags: string[];
  width?: number;
  height?: number;
  duration_seconds?: number;
  file_size_bytes?: number;
  modality?: MediaModality;
  backend?: RendererBackend;
  prompt?: string;
  seed?: number;
  created_at: string;
  /** Whether the file still exists on disk */
  exists: boolean;
}

export interface AssetSearchQuery {
  project_id?: ProjectId;
  job_id?: JobId;
  kind?: AssetKind;
  modality?: MediaModality;
  backend?: RendererBackend;
  tags?: string[];
  search?: string;      // full-text search on title/prompt/filename
  limit?: number;
  offset?: number;
  sort?: 'created_at_desc' | 'created_at_asc' | 'file_size_desc';
}

// ─── Routing Decision ────────────────────────────────────────────────────────

export interface RoutingDecision {
  backend: RendererBackend;
  workflow_name?: string;
  reason: string;
  fallback_available: boolean;
}

// ─── Platform Status ─────────────────────────────────────────────────────────

export interface BackendStatus {
  backend: RendererBackend;
  available: boolean;
  url?: string;
  message: string;
}

export interface PlatformStatus {
  version: string;
  backends: BackendStatus[];
  total_assets: number;
  total_jobs: number;
  active_jobs: number;
  uptime_seconds: number;
}

// ─── API Response Envelope ───────────────────────────────────────────────────

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  details?: string;
}

export type ApiResponse<T> = ApiOk<T> | ApiError;

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}

export function err(error: string, details?: string): ApiError {
  return { ok: false, error, details };
}
