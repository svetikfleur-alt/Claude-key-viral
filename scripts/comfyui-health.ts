import { loadConfig } from '../src/config.js';
import { ComfyUiClient } from '../src/comfyuiClient.js';

async function main() {
  const projectRoot = process.cwd();
  const config = await loadConfig(projectRoot);
  const client = new ComfyUiClient(config);

  const targets = new Set<string>();
  targets.add(config.comfyui_url);
  for (const entry of Object.values(config.workflows)) {
    if (entry.comfyui_url_override) targets.add(entry.comfyui_url_override);
  }

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

