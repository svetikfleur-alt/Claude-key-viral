# Claude MCP Media Runner

Local-first media pipeline for Claude that starts with structured code-rendered assets, keeps outputs organized and reproducible, and can connect to local ComfyUI workflows when richer image or video generation is actually needed.

Core promise: `Structure before randomness.`

## What This Is

- a local developer tool
- a Model Context Protocol server for Claude Desktop and other MCP clients
- a code-first media runner for banners, cards, diagrams, and structured videos
- a local ComfyUI bridge for optional image/video generation workflows
- an inspectable pipeline that writes run folders, manifests, reports, and output indexes

## What This Is Not

- not a hosted SaaS
- not a public Comfy service
- not a random one-shot image generator
- not a CAD / STL / Blender / 3D pipeline
- not a key-management tool
- not a mandatory cloud API wrapper

## Why Code-First Media

Most media tools start with randomness.

This project starts with structure:

1. define the media brief
2. choose the asset plan
3. pick the right renderer
4. render deterministically
5. validate files and layout assumptions
6. store outputs in organized folders
7. report what worked and what still needs the next pass

That foundation is better for:

- README hero visuals
- pipeline diagrams
- social launch cards
- feature overview assets
- controlled video explainers
- reproducible comparisons

Generative systems such as local ComfyUI are still useful, but as optional richness backends rather than the foundation.

## Current Capabilities

Works now:

- local MCP server startup
- local ComfyUI health checks and workflow execution helpers
- workflow dry runs and inspection
- code-rendered PNG + SVG launch assets
- scene-graph SVG rendering for arbitrary structured stills using text, panels, paths, circles, ellipses, polygons, gradients, filters, images, groups, and stacks
- SVG pipeline diagrams
- short and longer structured video rendering with Remotion
- SVG-scene-to-video rendering from the same structural code
- reference-driven cinematic treatment packs with extracted frames, shot boards, and preview videos
- organized output runs with manifests and reports
- static local gallery generated from the outputs index
- committed lightweight sample assets under `examples/generated-demo-assets/`

Planned later:

- richer gallery/index browsing
- stronger scene-specific video language
- workflow mapping helpers
- stronger ComfyUI inspection tooling
- optional BYOK/BYOC cloud backends

## Generated Demo Assets

Run the pipeline:

```bash
npm run media:demo
```

Generate a scenario suite (many scene types from the same DSL):

```bash
npm run media:scenarios
```

Generate the minimal launch asset pack (A–E required assets):

```bash
npm run media:launch
```

That creates a fresh run folder like:

```text
outputs/
  index.json
  gallery/
    index.html
  runs/
    2026-05-18_18-45-10/
      00_manifest.md
      01_static-launch-assets/
      02_pipeline-diagrams/
      03_social-cards/
      04_video-codegen/
      05_comfyui-placeholder-or-manual-test/
      06_cinematic-treatment/
      07_scene-graph-assets/
      08_scenario-suite/
      99_report.md
```

Committed lightweight samples live here:

```text
examples/generated-demo-assets/
```

## Output Folder Structure

- `00_manifest.md`
  Human-readable run manifest with generated assets, validation checks, limitations, and next test.
- `01_static-launch-assets/`
  Hero banner plus project-aligned launch cards.
- `02_pipeline-diagrams/`
  SVG architecture and flow visuals.
- `03_social-cards/`
  Shareable technical launch graphics.
- `04_video-codegen/`
  Short intro, longer structured demo video, and review notes.
- `05_comfyui-placeholder-or-manual-test/`
  Notes for how local ComfyUI fits into the pipeline.
- `06_cinematic-treatment/`
  Optional reference study, storyboard stills, and a more editorial preview video generated from real extracted frames.
- `07_scene-graph-assets/`
  Reusable SVG scene specs rendered as SVG, PNG, and SVG-driven video scenes.
- `99_report.md`
  Summary of what looks good, what is still weak, and what to do next.
- `gallery/index.html`
  Local gallery page for browsing recent runs and featured assets.

## Project Layout

```text
src/
  index.ts
  config.ts
  comfyuiClient.ts
  workflowStore.ts
  workflowPatcher.ts
  outputDetector.ts
  logger.ts
  types.ts
  comfyuiPaths.ts
  codegen/
    htmlCardRenderer.ts
    svgRenderer.ts
    sceneDslRenderer.ts
    remotionRenderer.ts
    remotionEntry.ts
  pipeline/
    cinematicTreatmentPack.ts
    demoAssetPack.ts
    outputGallery.ts
scripts/
  generate-media-demo.ts
tests/
examples/
workflows/
outputs/
```

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Run Checks

```bash
npm run check
npm test
```

## Start The MCP Server

```bash
npm start
```

This is a local stdio MCP server. Your MCP client launches it on your machine. There is no hosted public service.

For development:

```bash
npm run dev
```

## MCP Tools

- `health_check_comfyui`
- `list_comfyui_workflows`
- `inspect_comfyui_workflow`
- `dry_run_comfyui_workflow`
- `run_comfyui_workflow`
- `list_recent_outputs`
- `list_media_templates`
- `render_code_image`
- `render_svg_scene`
- `render_svg_scene_video`
- `render_svg_template`
- `save_svg_markup`
- `render_remotion_video`
- `generate_demo_asset_pack`
- `generate_cinematic_treatment_pack`
- `build_output_gallery`
- `copy_generated_png_to_comfyui_input`
- `generate_ai_image_futuristic_robot`
- `generate_ai_video_futuristic_robot`

## Claude Desktop Setup

Replace the path with your local build output:

```json
{
  "mcpServers": {
    "comfyui-mcp-runner": {
      "command": "node",
      "args": ["C:/path/to/comfyui-mcp-runner/dist/index.js"]
    }
  }
}
```

## How To Run The Asset Pipeline

Generate the full demo pack:

```bash
npm run media:demo
```

Generate a reference-driven cinematic treatment pack:

```bash
npm run media:treatment -- "C:/path/to/reference.mp4" "optional direction notes"
```

Or generate the full demo pack plus the treatment layer in one run:

```bash
npm run media:demo -- "C:/path/to/reference.mp4" "premium cinematic motion, environment-first, minimal overlays"
```

What it creates:

- GitHub hero banner
- pipeline diagram
- social launch card
- feature overview card
- capability / limitation card
- scene-graph stills rendered from reusable SVG scene specs
- short structured project intro video
- longer structured demo video
- a video assembled from SVG scene specs
- optional cinematic treatment cover, shot board, and preview video when a reference clip is supplied
- local gallery page
- manifest and report

Open the gallery after a run:

```text
outputs/gallery/index.html
```

## How ComfyUI Fits In

ComfyUI is preserved and supported, but it is not the whole story.

In this project:

- code renderers are the precise backend
- local ComfyUI is the optional richness backend

Use code renderers for:

- exact layout
- readable diagrams
- launch cards
- reusable scene-graph stills
- deterministic thumbnails
- structured video explainers
- SVG-described scene sequences

Use local ComfyUI for:

- realism
- stylistic richness
- local model experimentation
- image or video workflows that genuinely need generative output

This project does not install ComfyUI for all users.
This project does not install models for all users.
Each user runs ComfyUI locally on their own machine if they want that backend.

## Local ComfyUI Direction

Default local URL:

```text
http://127.0.0.1:8188
```

Some workflows in this repo use:

```text
http://127.0.0.1:8000
```

through per-workflow `comfyui_url_override` so the runner can target a different local ComfyUI instance when needed.

## Configure The Runner

Copy:

```text
config.example.json
```

to:

```text
config.json
```

Key fields:

- `comfyui_url`
- `workflows_dir`
- `logs_dir`
- `generated_media_dir`
- `outputs_index_file`
- `workflows.<name>.mappings`
- `workflows.<name>.comfyui_url_override`
- `workflows.<name>.default_inputs`

## Manual Real ComfyUI Test

This is the real acceptance path for the optional generative backend:

1. Start local ComfyUI.
2. Confirm `health_check_comfyui` succeeds.
3. Export a real workflow JSON into `workflows/`.
4. Map nodes in `config.json`.
5. Run `dry_run_comfyui_workflow`.
6. Run `run_comfyui_workflow`.
7. Confirm media files are returned and logged.

Do not treat dry-run alone as end-to-end proof.

## Future Video-As-Code Path

Current state:

- short project intro video works
- longer structured demo video works
- reference-driven cinematic treatment preview works
- local gallery generation works

Likely next exploration areas:

- richer Remotion scene systems
- Motion Canvas
- FFmpeg assembly
- gallery-driven review workflows

## Future Optional Generative Backends

Documented direction only for now:

- local ComfyUI workflows
- optional BYOK/BYOC integrations later
- optional model marketplaces later
- optional cloud image/video providers later

Those are not the foundation of the project.

The foundation is:

- code-first generation
- local-first execution
- reproducible outputs
- inspectable run folders

## Roadmap

- `v0.1` Local-first MCP runner foundation and ComfyUI direction
- `v0.2` Code-generated static media assets: HTML/CSS cards, SVG diagrams, launch asset pack
- `v0.3` Output manifests, local run folders, gallery/index direction
- `v0.4` MCP tools for rendering and output listing
- `v0.5` Video-as-code exploration: Remotion / Motion Canvas / FFmpeg
- `v0.6` ComfyUI workflow inspection and mapping helpers
- `v0.7` Optional cloud image/video backends with BYOK/BYOC
- `v1.0` Stable local-first structured media runner

## Limitations

- visual quality is improved, but still template-driven rather than a final brand system
- the longer video is still presentation-like rather than fully cinematic
- local ComfyUI success still depends on the user’s local runtime and models
- the gallery is static HTML rather than an interactive review app
- no automatic aesthetic scoring

## Security Notes

- no required API keys
- no cloud calls required for the code-first pipeline
- no arbitrary shell execution exposed to user input
- path handling is restricted for workflow and output operations
- generated transient output folders are kept under `outputs/runs/`

## Contributing

Good next contributions:

- stronger template library
- better diagram variants
- longer narrative video compositions
- output gallery / review UI
- more robust ComfyUI workflow helpers

Keep the direction clear:

- local-first
- code-first
- structure before randomness
- honest about what is implemented vs planned
