import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { ComfyUiClient } from '../comfyuiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

async function main() {
  const config = await loadConfig(projectRoot);
  const client = new ComfyUiClient(config);

  const targets = new Set<string>();
  targets.add(config.comfyui_url);
  for (const entry of Object.values(config.workflows)) {
    if (entry.comfyui_url_override) targets.add(entry.comfyui_url_override);
  }
  targets.add('http://127.0.0.1:8000');
  targets.add('http://127.0.0.1:8188');

  const results = [];
  for (const url of targets) {
    const result = await client.healthCheckUrl(url);
    results.push(result);
  }

  const ok = results.some((r) => r.reachable);
  process.stdout.write(`${JSON.stringify({ status: ok ? 'ok' : 'unreachable', config_path: config.config_path, results }, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`health check failed: ${(error as Error).message}\n`);
  process.exitCode = 2;
});

