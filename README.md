# comfyui-mcp-runner (v0.4)

Minimal local MCP server for running saved ComfyUI workflows with practical mapping helpers.

## What is ComfyUI?
ComfyUI is a local node-based workflow system for image/video generation. It exposes an HTTP API where a workflow JSON can be submitted and results can be read from history.

## Existing core tools
- `check_comfyui_health`
- `run_comfyui_workflow`

## New v0.4 tools
- `inspect_comfyui_workflow`
- `suggest_workflow_mapping`
- `create_preset_from_workflow`
- `list_recent_outputs`

## How this works
1. Workflows are loaded from `workflows/`.
2. You can inspect node IDs and roles offline.
3. You can generate mapping suggestions and presets.
4. Runs submit to ComfyUI and store successful results in output index.

## Configure Claude Desktop
```json
{
  "mcpServers": {
    "comfyui-mcp-runner": {
      "command": "node",
      "args": ["/absolute/path/to/comfyui-mcp-runner/dist/index.js"]
    }
  }
}
```

## Config
Use `config.json` (or fallback `config.example.json`) with:
- `comfyui_url`
- `workflows_dir`
- `logs_dir`
- `presets_dir`
- `outputs_index_file`
- `default_timeout_seconds`
- `polling_interval_seconds`
- `workflow_mappings`

## Inspect a ComfyUI workflow
Use `inspect_comfyui_workflow` to view node IDs, class types, possible roles, and key input fields without needing ComfyUI running.

## Find node IDs automatically
Use `suggest_workflow_mapping`. It uses practical heuristics and confidence levels (high/medium/low).

## Generate a preset from a workflow
Use `create_preset_from_workflow` with `confirm: true`.

## Dry-run before writing preset files
Use `create_preset_from_workflow` with `confirm: false` to preview the preset JSON.

## Track generated outputs
Successful runs are written to `outputs/index.json` (or configured path). Use `list_recent_outputs` to browse recent image/video outputs.

## Troubleshooting workflow mappings
- Missing mapping: run `suggest_workflow_mapping`, then adjust manually.
- Missing node ID: run `inspect_comfyui_workflow` and update mapping node IDs.
- Field cannot be patched: mapping path is wrong for that node.

## Important heuristic note
This tool does not magically understand every ComfyUI workflow. It uses practical heuristics to help users create mappings faster.

## Known limitations
- Heuristics are best-effort and may need manual correction.
- No cancellation tool yet.
