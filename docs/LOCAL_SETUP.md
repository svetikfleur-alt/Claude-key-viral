# Local Setup (ComfyUI Wiring)

This project is a **local-first MCP server**. It does not run a hosted service.

## Requirements

- Node.js 20+
- A working local ComfyUI installation (already installed by you)

This project **does not** install ComfyUI and **does not** install models.

## Configure

1. Copy `config.example.json` to `config.json` (or edit the existing `config.json`).
2. Confirm:
   - `comfyui_url` is correct (default `http://127.0.0.1:8188`)
   - `workflows_dir` points to `./workflows`
   - `logs_dir` points to `./logs`
3. Put exported workflow JSON files into `workflows/`.

## Start ComfyUI (manually)

Start your existing ComfyUI instance, then confirm you can open:

- `http://127.0.0.1:8188` (standard)
- or `http://127.0.0.1:8000` (Desktop-safe instance, if you use it)

This repo includes helper scripts (optional):

- `npm run comfyui:start`
- `npm run comfyui:desktop-safe:start`

These scripts start ComfyUI; they are expected to keep running until you stop them.

## Health Check (terminates)

Run:

```bash
npm run comfyui:health
```

If ComfyUI is not running, it returns a clear unreachable status.

