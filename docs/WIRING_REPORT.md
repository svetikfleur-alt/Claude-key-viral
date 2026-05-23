# WIRING_REPORT (Discovery + Current Status)

Date: 2026-05-21

## 1. Repository Root

`C:\Users\Lena\Claude-key-viral`

## 2. File Tree (Summary)

- `src/` TypeScript MCP server + ComfyUI client + workflow patching/output detection.
- `workflows/` Local ComfyUI workflow JSON files (API prompt format).
- `config.json` Local configuration (currently minimal).
- `config.example.json` Expanded example config (includes `qwen-image-edit-pro`, `wan-i2v-pro` placeholders).
- `logs/` Run logs + output index.
- `outputs/` Code-media pipeline runs (separate from ComfyUI generation logs).
- `comfyui-local/` A large local ComfyUI checkout present on disk (treated as an existing local backend, not managed by this tool).

## 3. Package / Build Setup

- `package.json` scripts: `build`, `start`, `dev`, `check`, `test`.
- Build: TypeScript -> `dist/`.
- Entry point (MCP server): `src/index.ts` -> `dist/index.js`.

## 4. MCP Server Entry Point

- `src/index.ts` defines MCP tools including:
  - `health_check_comfyui`
  - `list_comfyui_workflows`
  - `inspect_comfyui_workflow`
  - `dry_run_comfyui_workflow`
  - `run_comfyui_workflow`
  - `list_recent_outputs`

## 5. Existing ComfyUI Integration Code

- `src/comfyuiClient.ts`
  - health check: GET `/<base>/history`
  - queue: POST `/<base>/prompt`
  - poll: GET `/<base>/history/{prompt_id}`
  - timeout + retry/backoff logic for transient resets
- `src/workflowStore.ts`, `src/workflowPatcher.ts`, `src/outputDetector.ts`
  - loads workflow JSON from `workflows/`
  - patches configured node mappings
  - parses history payload outputs into image/video groups

## 6. Config Files

- `config.json` exists and is currently **minimal** (only `basic-image` workflow).
- `config.example.json` exists and shows the intended shape:
  - supports `generated_media_dir`
  - supports per-workflow `comfyui_url_override`
  - supports per-workflow `default_inputs`

## 7. Workflows Directory

`workflows/` contains:

- `basic-image.workflow.json` (uses a placeholder checkpoint name `example-model.safetensors`)
- `qwen-image-edit-pro.workflow.json` (Qwen image-edit stack filenames; expects local files)
- `wan-i2v-pro.workflow.json` (placeholder; mapping includes `node_id: "MISSING"`)

## 8. Outputs / Logs

- `logs/` stores per-run JSON logs + `logs/output-index.json`
- `outputs/` stores code-media pipeline runs (unrelated to ComfyUI outputs)

## 9. Is ComfyUI Running Right Now?

At discovery time, localhost ComfyUI was **not reachable**:

- `http://127.0.0.1:8188/history` -> connection refused
- `http://127.0.0.1:8000/history` -> connection refused

No process appeared to be listening on ports `8188` or `8000` at that moment.

This report does **not** claim an end-to-end ComfyUI generation success yet.

## 10. Local ComfyUI Paths in Config

- `config.example.json` references `http://127.0.0.1:8000` as an override for “Desktop-safe” runtime workflows.
- `config.json` currently uses default `http://127.0.0.1:8188`.

## 11. Real Workflow Availability

Workflow JSON files exist locally, but:

- `basic-image.workflow.json` references a placeholder checkpoint filename, which will fail unless the user updates it to a real installed checkpoint.
- `qwen-image-edit-pro.workflow.json` references specific Qwen model filenames; it will work only if those files exist in the user’s ComfyUI model folders.
- `wan-i2v-pro.workflow.json` is explicitly incomplete (mapping placeholder).

## 12. What Is Missing For A Real End-to-End Run?

To achieve the chain:

MCP runner → ComfyUI health check → workflow → queue → poll → output file detected → report/log returned

the following must be true:

1. ComfyUI must be started by the user on `8188` or `8000`.
2. A workflow must reference models that exist in the local ComfyUI installation.
3. `config.json` must point to a workflow file + correct node mappings.

Next steps are documented in `docs/RUNBOOK.md`.

---

## Update (Verified End-to-End) — 2026-05-23

This section reflects an actual end-to-end run performed on 2026-05-23 (no fake success).

### ComfyUI Reachability

- `http://127.0.0.1:8000` reachable (ComfyUI Desktop-safe instance).
- `http://127.0.0.1:8188` unreachable (not running).

### Real ComfyUI Run (No Models Required)

Workflow: `passthrough-image` (LoadImage -> SaveImage)

- prompt_id: `05093ba4-b59d-4d17-8a31-c32f3f55d48b`
- Output detected from history.
- Resolved output path:
  - `C:\Users\Lena\Documents\ComfyUI\output\mvp_passthrough_2026-05-23_12-19-17_00001_.png`

### Hybrid Pack (ComfyUI Background + Deterministic Overlay)

Hybrid run dir:

- `outputs/runs/2026-05-23_12-19-21/hybrid-comfy/`

Generated assets:

- `cards/nature-overlay.png` (+ `.svg`)
- `cards/travel-promo.png` (+ `.svg`)

Background output (ComfyUI output dir):

- `C:\Users\Lena\Documents\ComfyUI\output\mcp_hybrid_2026-05-23_12-19-21_00001_.png`

### Notes / Limitations

- “Traditional AI” scenic generation (txt2img / checkpoints) is still gated by local model availability. If ComfyUI reports missing checkpoints, the runner now surfaces clearer suggestions, but it will not download gated models automatically.
