# Basic Workflow Mapping Notes

1. Export a workflow from ComfyUI as API JSON and place it in `workflows/`.
2. Find the node IDs for your prompt, seed, width, and height nodes.
3. Map each user-facing input to the exact `node_id` and `field_path`.

Common patterns:
- `CLIPTextEncode` prompt text: `["inputs", "text"]`
- `KSampler` seed: `["inputs", "seed"]`
- `EmptyLatentImage` size: `["inputs", "width"]` and `["inputs", "height"]`

Use `inspect_comfyui_workflow` if you need a quick node summary before editing `config.json`.
