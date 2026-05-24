import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { ComfyUiClient } from '../comfyuiClient.js';
import { evaluateNatureReadiness, getComfyRuntimeInventory } from '../comfyuiReadiness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

async function main() {
  const config = await loadConfig(projectRoot);
  const client = new ComfyUiClient(config);

  const candidates = Array.from(new Set([
    config.comfyui_url,
    ...Object.values(config.workflows).map((entry) => entry.comfyui_url_override).filter((value): value is string => typeof value === 'string' && value.length > 0),
    'http://127.0.0.1:8000',
    'http://127.0.0.1:8188',
  ]));

  const healthResults = [];
  let resolvedUrl: string | undefined;
  for (const url of candidates) {
    const health = await client.healthCheckUrl(url);
    healthResults.push(health);
    if (health.reachable) {
      resolvedUrl = url;
      break;
    }
  }

  if (!resolvedUrl) {
    process.stdout.write(`${JSON.stringify({
      status: 'unreachable',
      config_path: config.config_path,
      results: healthResults,
    }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const inventory = await getComfyRuntimeInventory(client, resolvedUrl);
  const nature = evaluateNatureReadiness(inventory);
  process.stdout.write(`${JSON.stringify({
    status: nature.status,
    config_path: config.config_path,
    comfyui_url: resolvedUrl,
    inventory,
    nature_readiness: nature,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`nature readiness failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
