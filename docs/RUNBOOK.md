# RUNBOOK (Real End-to-End ComfyUI Run)

Goal chain:

MCP runner → ComfyUI health check → workflow file → mapping patch → queue → poll → output detected → log/report

## 1. Start ComfyUI

Start your existing ComfyUI server and verify it in a browser:

- `http://127.0.0.1:8188`

If you use a separate instance (example: Desktop-safe):

- `http://127.0.0.1:8000`

## 2. Verify Health (terminates)

```bash
npm run comfyui:health
```

If `tsx` is not usable in your environment (for example, restricted child-process spawning), use:

```bash
npm run comfyui:health:dist
```

If it reports `unreachable`, ComfyUI is not running at the configured URL(s).

## 3. Add / Export a Workflow

Put an exported ComfyUI API prompt JSON into `workflows/`.

Notes:

- `workflows/basic-image.workflow.json` references a placeholder checkpoint name and will fail until you point it at a real checkpoint.
- `workflows/qwen-image-edit-pro.workflow.json` requires the local Qwen files referenced inside the workflow JSON.

## 4. Configure Mapping

Edit `config.json`:

- `workflows.<name>.file` must match a JSON file in `workflows/`
- `workflows.<name>.mappings.*` must point to real node IDs and input fields

If a mapping points to a missing node, the runner returns a clear error.

## 5. Run A Real Job (terminates)

```bash
npm run comfyui:run -- qwen-image-edit-pro "turn this into a cinematic landscape photo"
```

or (after you update the checkpoint in `basic-image.workflow.json`):

```bash
npm run comfyui:run -- basic-image "a cinematic fox walking through foggy pines at dawn"
```

If `tsx` is not usable in your environment, use the compiled runner:

```bash
npm run comfyui:run:dist -- --workflow passthrough-image --extra "{\"filename_prefix\":\"manual_test\"}"
```

## 6. Where Results Go

- Logs: `logs/<runId>.json`
- Output index: `logs/output-index.json`
- Human run report: `outputs/runs/<timestamp>/RUN_REPORT.md`

## Troubleshooting

- ComfyUI not running:
  - start ComfyUI
  - re-run `npm run comfyui:health`
- Wrong port:
  - update `comfyui_url` or per-workflow `comfyui_url_override`
- Missing model / checkpoint:
  - update the workflow JSON to reference a model that exists in your ComfyUI `models/` folders
- Polling timeout:
  - increase `polling_timeout_seconds` in `config.json`
- Queued but no output detected:
  - inspect `logs/<runId>.json` and the ComfyUI server console/history
