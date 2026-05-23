import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../dist/config.js';
import { safeCopyFileIntoDir } from '../dist/comfyuiPaths.js';
import { detectOutputsFromHistory } from '../dist/outputDetector.js';
import { dryRunPatchWorkflow, patchWorkflowForRun } from '../dist/workflowPatcher.js';
import { loadWorkflow } from '../dist/workflowStore.js';

async function makeTempProject(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comfyui-mcp-runner-'));
  await fs.mkdir(path.join(dir, 'workflows'), { recursive: true });
  await fs.mkdir(path.join(dir, 'logs'), { recursive: true });
  await fs.mkdir(path.join(dir, 'generated-media'), { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents, 'utf8');
  }
  return dir;
}

async function run(name, fn) {
  const started = Date.now();
  try {
    await fn();
    process.stdout.write(`ok  ${name}  (${Date.now() - started}ms)\n`);
  } catch (err) {
    process.stderr.write(`FAIL ${name}\n${err?.stack ?? String(err)}\n`);
    process.exitCode = 1;
  }
}

const workflowFixture = JSON.stringify({
  '3': {
    inputs: { seed: 1, steps: 20, cfg: 8, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    class_type: 'KSampler',
  },
  '5': {
    inputs: { width: 512, height: 512, batch_size: 1 },
    class_type: 'EmptyLatentImage',
  },
  '6': {
    inputs: { text: 'A sample positive prompt', clip: ['4', 1] },
    class_type: 'CLIPTextEncode',
  },
  '7': {
    inputs: { text: 'A sample negative prompt', clip: ['4', 1] },
    class_type: 'CLIPTextEncode',
  },
  '8': {
    inputs: { images: ['9', 0], filename_prefix: 'ComfyUI' },
    class_type: 'SaveImage',
  },
}, null, 2);

await run('config: output index must be inside logs dir', async () => {
  const root = await makeTempProject({
    'config.json': JSON.stringify({
      comfyui_url: 'http://127.0.0.1:8188',
      workflows_dir: './workflows',
      logs_dir: './logs',
      generated_media_dir: './generated-media',
      outputs_index_file: './outside/output-index.json',
      request_timeout_seconds: 30,
      polling_interval_seconds: 2,
      polling_timeout_seconds: 300,
      workflows: {},
    }),
  });

  await assert.rejects(() => loadConfig(root), /Path safety error/);
});

await run('config: supports per-workflow comfyui_url_override + default_inputs', async () => {
  const root = await makeTempProject({
    'config.json': JSON.stringify({
      comfyui_url: 'http://127.0.0.1:8188',
      workflows_dir: './workflows',
      logs_dir: './logs',
      generated_media_dir: './generated-media',
      outputs_index_file: './logs/output-index.json',
      request_timeout_seconds: 30,
      polling_interval_seconds: 2,
      polling_timeout_seconds: 300,
      workflows: {
        'qwen-image-edit-pro': {
          file: 'qwen-image-edit-pro.workflow.json',
          comfyui_url_override: 'http://127.0.0.1:8000',
          default_inputs: { extra_params: { denoise: 0.7 } },
          mappings: {},
        },
      },
    }),
    'workflows/qwen-image-edit-pro.workflow.json': '{}',
  });

  const config = await loadConfig(root);
  assert.equal(config.workflows['qwen-image-edit-pro'].comfyui_url_override, 'http://127.0.0.1:8000');
  assert.equal(config.workflows['qwen-image-edit-pro'].default_inputs.extra_params.denoise, 0.7);
});

await run('safeCopyFileIntoDir: blocks path traversal', async () => {
  const root = await makeTempProject({
    'generated-media/source.png': 'not-a-real-png',
  });

  const destDir = path.join(root, 'comfy-input');
  await fs.mkdir(destDir, { recursive: true });

  await assert.rejects(
    () => safeCopyFileIntoDir({
      sourcePath: path.join(root, 'generated-media', 'source.png'),
      destDir,
      destFilename: '../evil.png',
    }),
    /(Path safety error|Invalid filename)/,
  );
});

await run('workflow patching: applies mapped fields and reports warnings', async () => {
  const root = await makeTempProject({
    'config.json': JSON.stringify({
      comfyui_url: 'http://127.0.0.1:8188',
      workflows_dir: './workflows',
      logs_dir: './logs',
      generated_media_dir: './generated-media',
      outputs_index_file: './logs/output-index.json',
      request_timeout_seconds: 30,
      polling_interval_seconds: 2,
      polling_timeout_seconds: 300,
      workflows: {
        'basic-image': {
          file: 'basic-image.workflow.json',
          description: 'Test workflow',
          mappings: {
            positive_prompt: { node_id: '6', field_path: ['inputs', 'text'] },
            negative_prompt: { node_id: '7', field_path: ['inputs', 'text'] },
            seed: { node_id: '3', field_path: ['inputs', 'seed'] },
            width: { node_id: '5', field_path: ['inputs', 'width'] },
            height: { node_id: '5', field_path: ['inputs', 'height'] },
            extra_params: {
              steps: { node_id: '3', field_path: ['inputs', 'steps'] },
            },
          },
        },
      },
    }),
    'workflows/basic-image.workflow.json': workflowFixture,
  });

  const config = await loadConfig(root);
  const loaded = await loadWorkflow(config, 'basic-image');

  const dry = dryRunPatchWorkflow(loaded.workflow_name, loaded.workflow, loaded.configured_entry.mappings, {
    workflow_name: loaded.workflow_name,
    positive_prompt: 'NEW POS',
    negative_prompt: 'NEW NEG',
    seed: 42,
    width: 1024,
    height: 768,
    extra_params: { steps: 11, unknown_key: 'ok-to-warn' },
  });

  assert.ok(dry.changed_nodes.length >= 1);
  assert.equal(dry.final_mapped_parameters.seed, 42);
  assert.equal(dry.final_mapped_parameters.width, 1024);
  assert.ok(Array.isArray(dry.warnings));

  const patched = patchWorkflowForRun(loaded.workflow_name, loaded.workflow, loaded.configured_entry.mappings, {
    workflow_name: loaded.workflow_name,
    positive_prompt: 'NEW POS',
    negative_prompt: 'NEW NEG',
    seed: 42,
    width: 1024,
    height: 768,
    extra_params: { steps: 11, unknown_key: 'ok-to-warn' },
  });

  assert.equal(patched.workflow['6'].inputs.text, 'NEW POS');
  assert.equal(patched.workflow['7'].inputs.text, 'NEW NEG');
  assert.equal(patched.workflow['3'].inputs.seed, 42);
  assert.equal(patched.workflow['5'].inputs.width, 1024);
  assert.equal(patched.workflow['3'].inputs.steps, 11);
  assert.ok(patched.warnings.some((w) => String(w).includes('unknown_key')));
});

await run('output grouping: images/videos/other', async () => {
  const history = {
    'abc': {
      outputs: {
        '9': {
          images: [
            { filename: 'a.png', subfolder: '', type: 'output' },
            { filename: 'b.webp', subfolder: 'sub', type: 'output' },
          ],
          gifs: [
            { filename: 'c.gif', subfolder: '', type: 'output' },
          ],
          videos: [
            { filename: 'd.mp4', subfolder: '', type: 'output' },
          ],
          files: [
            { filename: 'e.txt', subfolder: '', type: 'output' },
          ],
        },
      },
    },
  };

  const outputs = detectOutputsFromHistory(history, 'abc');
  assert.equal(outputs.images.length, 3);
  assert.equal(outputs.videos.length, 1);
  assert.equal(outputs.other.length, 1);
});

process.exit(process.exitCode ?? 0);
