# Example MCP Tool Call: `dry_run_comfyui_workflow`

Use this before a real run to confirm mappings without contacting ComfyUI.

```json
{
  "workflow_name": "basic-image",
  "positive_prompt": "a futuristic tram crossing a rainy city at dusk",
  "negative_prompt": "lowres, watermark",
  "seed": 4242,
  "width": 1024,
  "height": 576,
  "extra_params": {
    "steps": 24
  }
}
```
