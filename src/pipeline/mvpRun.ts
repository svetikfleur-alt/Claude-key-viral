import fs from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from '../config.js';
import { ComfyUiClient } from '../comfyuiClient.js';
import { ensureLogFiles, writeRunLog } from '../logger.js';
import { loadWorkflow } from '../workflowStore.js';
import { patchWorkflowForRun } from '../workflowPatcher.js';
import { detectOutputsFromHistory } from '../outputDetector.js';
import { generateVisualBenchmark } from './visualBenchmark.js';
import { generateHybridComfyOverlayPack } from './hybridComfyPack.js';
import { renderRemotionVideo } from '../codegen/remotionRenderer.js';
import type { MediaPipelineRunResult } from '../types.js';

type MvpResult = {
  mvp_run_dir: string;
  visual_benchmark?: Pick<MediaPipelineRunResult, 'run_dir' | 'manifest_path' | 'report_path' | 'gallery_path'>;
  hybrid_comfy_pack?: Pick<MediaPipelineRunResult, 'run_dir' | 'manifest_path' | 'report_path'> & { comfyui_background_resolved?: string };
  intro_video_pro?: { file_path: string; duration_seconds: number; width: number; height: number; fps: number };
  comfyui_health: Array<{ url: string; reachable: boolean; message: string }>;
  comfyui_passthrough?: {
    status: 'completed' | 'failed';
    comfyui_url: string;
    prompt_id?: string;
    outputs?: unknown;
    resolved_output_paths?: string[];
    error?: string;
  };
  comfyui_real_image?: {
    status: 'completed' | 'failed' | 'skipped';
    workflow_name: string;
    comfyui_url?: string;
    prompt_id?: string;
    resolved_output_paths?: string[];
    source_image?: string;
    error?: string;
  };
  notes: string[];
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function stamp(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExistsAndNonEmpty(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function runMvp(projectRoot: string, opts?: { includeVideo?: boolean }): Promise<MvpResult> {
  const notes: string[] = [];
  const runId = stamp();
  const outputsRoot = path.join(projectRoot, 'outputs');
  const runDir = path.join(outputsRoot, 'runs', runId, 'mvp');
  await ensureDir(runDir);

  const config = await loadConfig(projectRoot);
  await ensureLogFiles(config);
  const client = new ComfyUiClient(config);

  // 1) Visual benchmark (code-first assets)
  let benchmark: MvpResult['visual_benchmark'] | undefined;
  try {
    const bench = await generateVisualBenchmark(projectRoot, { includeVideo: opts?.includeVideo !== false });
    benchmark = {
      run_dir: bench.run_dir,
      manifest_path: bench.manifest_path,
      report_path: bench.report_path,
      gallery_path: bench.gallery_path,
    };
  } catch (error) {
    notes.push(`visual benchmark failed: ${(error as Error).message}`);
  }

  // 2) ComfyUI health (prefer 8000, also check config default + 8188)
  const urls = Array.from(new Set([
    config.comfyui_url,
    'http://127.0.0.1:8000',
    'http://127.0.0.1:8188',
  ]));
  const comfyui_health: MvpResult['comfyui_health'] = [];
  for (const url of urls) {
    const result = await client.healthCheckUrl(url);
    comfyui_health.push({ url, reachable: result.reachable, message: result.message });
  }
  const anyReachable = comfyui_health.some((entry) => entry.reachable);

  // 3) Minimal real ComfyUI run (no heavy models): passthrough-image
  // This proves: runner -> queue -> history -> output detection -> report.
  let passthrough: MvpResult['comfyui_passthrough'] | undefined;
  let realImage: MvpResult['comfyui_real_image'] | undefined;
  const reachable = comfyui_health.find((h) => h.reachable)?.url;
  if (!reachable) {
    notes.push('ComfyUI is unreachable; skipped passthrough-image run.');
  } else {
    const runLog = path.join(config.logs_dir_abs, `mvp-${runId}.json`);
    try {
      const loaded = await loadWorkflow(config, 'passthrough-image');
      const comfyUrl = loaded.configured_entry?.comfyui_url_override ?? reachable;
      const patched = patchWorkflowForRun(loaded.workflow_name, loaded.workflow, loaded.configured_entry?.mappings, {
        workflow_name: loaded.workflow_name,
        positive_prompt: '(unused)',
        extra_params: {
          filename_prefix: `mvp_passthrough_${runId}`,
        },
      });

      await writeRunLog(runLog, {
        timestamp: new Date().toISOString(),
        workflow_name: loaded.workflow_name,
        comfyui_url: comfyUrl,
        input_parameters: { workflow_name: loaded.workflow_name },
        prompt_json: patched.workflow,
        warnings: patched.warnings,
        status: 'queued',
      });

      const queued = await client.queuePrompt(patched.workflow, comfyUrl);
      const history = await client.waitForPrompt(queued.prompt_id, comfyUrl);
      const outputs = detectOutputsFromHistory(history, queued.prompt_id);
      const outDir = config.comfyui_output_dir_abs;
      const resolved = typeof outDir === 'string'
        ? outputs.images.map((item) => path.join(outDir, item.subfolder ?? '', item.filename ?? item.path))
        : [];

      await writeRunLog(runLog, {
        timestamp: new Date().toISOString(),
        workflow_name: loaded.workflow_name,
        prompt_id: queued.prompt_id,
        comfyui_url: comfyUrl,
        input_parameters: { workflow_name: loaded.workflow_name },
        prompt_json: patched.workflow,
        warnings: [...patched.warnings, ...outputs.warnings],
        status: 'completed',
        outputs,
      });

      passthrough = {
        status: 'completed',
        comfyui_url: comfyUrl,
        prompt_id: queued.prompt_id,
        outputs,
        resolved_output_paths: resolved,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunLog(runLog, {
        timestamp: new Date().toISOString(),
        workflow_name: 'passthrough-image',
        comfyui_url: reachable,
        input_parameters: { workflow_name: 'passthrough-image' },
        status: 'failed',
        error: message,
      });
      passthrough = { status: 'failed', comfyui_url: reachable, error: message };
      notes.push(`passthrough-image failed: ${message}`);
    }
  }

  // 3b) Attempt one real local image workflow if the installed stack is available.
  // This is the honest quality gate: either we get an actual generative image, or we record
  // exactly why the local model path is not production-ready yet.
  if (!reachable) {
    realImage = {
      status: 'skipped',
      workflow_name: 'qwen-image-edit-pro',
      error: 'ComfyUI was unreachable, so the real local image workflow was skipped.',
    };
  } else {
    const runLog = path.join(config.logs_dir_abs, `mvp-qwen-${runId}.json`);
    const candidateInputs = [
      path.join(config.comfyui_input_dir_abs ?? '', 'mcp-background.png'),
      path.join(config.comfyui_input_dir_abs ?? '', '02_qwen_Image_edit_subgraphed_input_image.png'),
      path.join(config.comfyui_input_dir_abs ?? '', 'robot-source.png'),
    ];
    const sourceImage = await (async () => {
      for (const candidate of candidateInputs) {
        if (await fileExistsAndNonEmpty(candidate)) {
          return path.basename(candidate);
        }
      }
      return 'robot-source.png';
    })();

    try {
      const loaded = await loadWorkflow(config, 'qwen-image-edit-pro');
      const comfyUrl = loaded.configured_entry?.comfyui_url_override ?? reachable;
      const patched = patchWorkflowForRun(loaded.workflow_name, loaded.workflow, loaded.configured_entry?.mappings, {
        workflow_name: loaded.workflow_name,
        positive_prompt: 'Transform this input into a premium cinematic product visual for a local-first media runner. Dark developer-tool mood, polished lighting, realistic materials, subtle atmospheric depth, refined composition, no text, no infographic labels, no cartoon style.',
        extra_params: {
          source_image: sourceImage,
          filename_prefix: `mvp_qwen_${runId}`,
          clip_device: 'default',
          steps: 4,
          cfg: 1,
          denoise: 0.72,
        },
      });

      await writeRunLog(runLog, {
        timestamp: new Date().toISOString(),
        workflow_name: loaded.workflow_name,
        comfyui_url: comfyUrl,
        input_parameters: { source_image: sourceImage },
        prompt_json: patched.workflow,
        warnings: patched.warnings,
        status: 'queued',
      });

      const queued = await client.queuePrompt(patched.workflow, comfyUrl);
      const history = await client.waitForPrompt(queued.prompt_id, comfyUrl);
      const outputs = detectOutputsFromHistory(history, queued.prompt_id);
      const outDir = config.comfyui_output_dir_abs;
      const resolved = typeof outDir === 'string'
        ? outputs.images.map((item) => path.join(outDir, item.subfolder ?? '', item.filename ?? item.path))
        : [];

      await writeRunLog(runLog, {
        timestamp: new Date().toISOString(),
        workflow_name: loaded.workflow_name,
        prompt_id: queued.prompt_id,
        comfyui_url: comfyUrl,
        input_parameters: { source_image: sourceImage },
        prompt_json: patched.workflow,
        warnings: [...patched.warnings, ...outputs.warnings],
        status: 'completed',
        outputs,
      });

      realImage = {
        status: 'completed',
        workflow_name: loaded.workflow_name,
        comfyui_url: comfyUrl,
        prompt_id: queued.prompt_id,
        resolved_output_paths: resolved,
        source_image: sourceImage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunLog(runLog, {
        timestamp: new Date().toISOString(),
        workflow_name: 'qwen-image-edit-pro',
        comfyui_url: reachable,
        input_parameters: { source_image: sourceImage },
        status: 'failed',
        error: message,
      });
      realImage = {
        status: /unreachable while waiting|network reset|server restart/i.test(message) ? 'failed' : 'failed',
        workflow_name: 'qwen-image-edit-pro',
        comfyui_url: reachable,
        source_image: sourceImage,
        error: message,
      };
      notes.push(`qwen-image-edit-pro failed: ${message}`);
    }
  }

  // 4) Hybrid ComfyUI + code overlays (uses passthrough-any-image by default)
  let hybrid: MvpResult['hybrid_comfy_pack'] | undefined;
  try {
    const preferredHybridSources = [
      ...(realImage?.resolved_output_paths ?? []),
      path.join(runDir, '..', 'visual-benchmark', '09-video-intro-frame', 'video-intro-frame.png'),
      path.join(runDir, '..', 'visual-benchmark', '08-abstract-background', 'abstract-background.png'),
      ...(passthrough?.resolved_output_paths ?? []),
    ];
    const pack = await generateHybridComfyOverlayPack(projectRoot, {
      preferredSourcePaths: preferredHybridSources,
      allowReferenceStudies: false,
    });
    hybrid = {
      run_dir: pack.run_dir,
      manifest_path: pack.manifest_path,
      report_path: pack.report_path,
      comfyui_background_resolved: pack.comfyui_background_resolved,
    };
  } catch (error) {
    notes.push(`hybrid comfy pack failed: ${(error as Error).message}`);
  }

  // 5) Pro intro video (Remotion, 1080p, longer)
  let introVideo: MvpResult['intro_video_pro'] | undefined;
  if (opts?.includeVideo !== false) {
    try {
      const outDir = path.join(runDir, 'video-pro');
      // Optional user-provided audio assets. We don't ship any copyrighted tracks;
      // users can drop their own licensed files into public/audio/.
      const musicPath = path.join(projectRoot, 'public', 'audio', 'music-bed.mp3');
      const voicePath = path.join(projectRoot, 'public', 'audio', 'voiceover.wav');
      const hasMusic = await fileExistsAndNonEmpty(musicPath);
      const hasVoice = await fileExistsAndNonEmpty(voicePath);
      const rendered = await renderRemotionVideo({
        title: 'Claude MCP Media Runner',
        subtitle: 'Code-first structured media + optional local ComfyUI backgrounds.',
        theme: 'slate',
        visual_style: 'pipeline_intro_pro',
        width: 1920,
        height: 1080,
        fps: 30,
        duration_seconds: 45,
        output_name: 'pipeline-intro-pro-1080p',
        music_src: hasMusic ? 'audio/music-bed.mp3' : undefined,
        voiceover_src: hasVoice ? 'audio/voiceover.wav' : undefined,
        music_volume: 0.18,
        voiceover_volume: 1.0,
      }, outDir);
      introVideo = {
        file_path: rendered.file_path,
        duration_seconds: rendered.duration_seconds,
        width: rendered.width,
        height: rendered.height,
        fps: rendered.fps,
      };
    } catch (error) {
      notes.push(`intro video render failed: ${(error as Error).message}`);
    }
  }

  // 6) MVP report (single human-readable entrypoint)
  const reportPath = path.join(runDir, 'MVP_REPORT.md');
  const lines: string[] = [
    '# MVP Report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Run id: \`${runId}\``,
    '',
    '## What this MVP proves',
    '',
    '- Code-first structured media pipeline can generate multiple visual classes (static + video-as-code).',
    anyReachable
      ? '- Local ComfyUI can be reached and invoked from the same repo (local-first; no cloud).'
      : '- Local ComfyUI is wired, but this run did not reach a live local instance, so Comfy-specific quality was not proven here.',
    '- The repo can distinguish between a wiring-only success (passthrough) and a real generative success/failure.',
    '- Outputs are written and detectable (including resolved output paths when configured).',
    '',
    '## Visual benchmark',
    '',
    benchmark
      ? `- Run dir: \`${path.relative(projectRoot, benchmark.run_dir).replace(/\\\\/g, '/')}\`\n- Report: \`${path.relative(projectRoot, benchmark.report_path).replace(/\\\\/g, '/')}\``
      : '- (failed or skipped)',
    '',
    '## Hybrid ComfyUI overlays',
    '',
    hybrid
      ? `- Run dir: \`${path.relative(projectRoot, path.join(hybrid.run_dir, 'hybrid-comfy')).replace(/\\\\/g, '/')}\`\n- Report: \`${path.relative(projectRoot, hybrid.report_path).replace(/\\\\/g, '/')}\`\n- Background: ${hybrid.comfyui_background_resolved ?? '(none)'}`
      : '- (failed or skipped)',
    '',
    '## Pro intro video (Remotion)',
    '',
    introVideo
      ? `- File: \`${path.relative(projectRoot, introVideo.file_path).replace(/\\\\/g, '/')}\`\n- Duration: ${introVideo.duration_seconds}s @ ${introVideo.fps}fps (${introVideo.width}x${introVideo.height})`
      : '- (skipped or failed)',
    '',
    '## ComfyUI health',
    '',
    ...comfyui_health.map((h) => `- ${h.reachable ? 'OK' : 'FAIL'}: ${h.url} — ${h.message}`),
    '',
    '## ComfyUI minimal run (passthrough-image)',
    '',
    passthrough
      ? [
        `- Status: ${passthrough.status}`,
        `- URL: ${passthrough.comfyui_url}`,
        ...(passthrough.prompt_id ? [`- prompt_id: ${passthrough.prompt_id}`] : []),
        ...(passthrough.resolved_output_paths?.length ? ['- Resolved output paths:', ...passthrough.resolved_output_paths.map((p) => `  - ${p}`)] : []),
        ...(passthrough.error ? [`- Error: ${passthrough.error}`] : []),
      ].join('\n')
      : '- (skipped)',
    '',
    '## ComfyUI real local image attempt',
    '',
    realImage
      ? [
        `- Workflow: ${realImage.workflow_name}`,
        `- Status: ${realImage.status}`,
        ...(realImage.comfyui_url ? [`- URL: ${realImage.comfyui_url}`] : []),
        ...(realImage.source_image ? [`- Source image: ${realImage.source_image}`] : []),
        ...(realImage.prompt_id ? [`- prompt_id: ${realImage.prompt_id}`] : []),
        ...(realImage.resolved_output_paths?.length ? ['- Resolved output paths:', ...realImage.resolved_output_paths.map((p) => `  - ${p}`)] : []),
        ...(realImage.error ? [`- Error: ${realImage.error}`] : []),
      ].join('\n')
      : '- (skipped)',
    '',
    '## Notes',
    '',
    ...(notes.length ? notes.map((n) => `- ${n}`) : ['- (none)']),
    '',
    '## Next step',
    '',
    '- If the real local image attempt fails with a restart/network reset, the Qwen stack is present but not yet stable on this machine; treat that as a hardware/runtime issue, not a fake success.',
    '- Keep “nature/travel” outputs hybrid: scenic background from local ComfyUI (or local photos) + deterministic overlay from code.',
  ];
  await fs.writeFile(reportPath, `${lines.join('\n')}\n`, 'utf8');

  return {
    mvp_run_dir: runDir,
    visual_benchmark: benchmark,
    hybrid_comfy_pack: hybrid,
    intro_video_pro: introVideo,
    comfyui_health,
    comfyui_passthrough: passthrough,
    comfyui_real_image: realImage,
    notes,
  };
}
