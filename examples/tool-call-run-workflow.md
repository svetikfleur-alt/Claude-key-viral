# Example MCP Tool Call: `run_comfyui_workflow`

```json
{
  "workflow_name": "basic-image",
  "positive_prompt": "cinematic shot of a fox walking through foggy pines",
  "negative_prompt": "low quality, blurry, text",
  "seed": 12345,
  "width": 768,
  "height": 512,
  "extra_params": {
    "steps": 28,
    "cfg": 7.5
  }
}
```

Expected result shape:

```json
{
  "status": "completed",
  "workflow_name": "basic-image",
  "prompt_id": "abc123",
  "output_files": {
    "images": [],
    "videos": [],
    "other": []
  },
  "duration_seconds": 12.4,
  "log_file": "C:/path/to/comfyui-mcp-runner/logs/<run-id>.json",
  "warnings": []
}
```
