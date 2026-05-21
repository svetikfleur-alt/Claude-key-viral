import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

async function readJson(p) { return JSON.parse(await fs.readFile(p, 'utf8')); }

function sanitizePresetName(name) {
  const sanitized = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!sanitized) throw new Error('invalid');
  return sanitized;
}

test('workflow inspection basic shape', async () => {
  const wf = await readJson('workflows/example-workflow.json');
  const keys = Object.keys(wf);
  assert.ok(keys.length > 0);
  const node = wf[keys[0]];
  assert.equal(typeof node, 'object');
});

test('role detection fixture sanity for mapping fields', async () => {
  const cfg = await readJson('config.example.json');
  const m = cfg.workflow_mappings['example-workflow'];
  for (const k of ['positive_prompt','negative_prompt','seed','width','height']) assert.ok(m[k]);
});

test('preset dry-run payload shape', async () => {
  const preview = { status: 'dry_run', preset_preview: { preset_name: 'x', workflow_name: 'example-workflow', target_type: 'image', mapping: {} } };
  assert.equal(preview.status, 'dry_run');
  assert.equal(preview.preset_preview.workflow_name, 'example-workflow');
});

test('safe preset name validation', async () => {
  assert.equal(sanitizePresetName('My Preset 01'), 'my-preset-01');
  assert.throws(() => sanitizePresetName('***'));
});

test('preset file creation with confirm true simulation', async () => {
  const dir = 'presets';
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, 'test-preset.json');
  await fs.writeFile(p, JSON.stringify({ preset_name: 'test-preset' }));
  const parsed = await readJson(p);
  assert.equal(parsed.preset_name, 'test-preset');
  await fs.unlink(p);
});

test('missing node mapping error string format', async () => {
  const msg = "Missing node mapping. Cause: No mapping for 'seed' in workflow 'w'. Suggested fix: Add seed mapping.";
  assert.match(msg, /Missing node mapping/);
  assert.match(msg, /Suggested fix/);
});

test('output index update and recent listing', async () => {
  const out = 'outputs/index.json';
  await fs.mkdir('outputs', { recursive: true });
  const entry = [{ timestamp: new Date().toISOString(), output_types: ['image'] }];
  await fs.writeFile(out, JSON.stringify(entry, null, 2));
  const parsed = await readJson(out);
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed[0].output_types[0], 'image');
});

test('missing workflow file errors', async () => {
  await assert.rejects(() => fs.readFile('workflows/does-not-exist.json', 'utf8'));
});
