import type { ComfyHealthResult, ComfyQueueResult, JsonObject, ResolvedConfig } from './types.js';

function timeoutMs(seconds: number): number {
  return Math.floor(seconds * 1000);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutSeconds: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(timeoutSeconds));
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`ComfyUI request timed out. Cause: no response from ${url}. Suggested fix: increase request_timeout_seconds or check whether ComfyUI is overloaded.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateForError(value: string): string {
  return value.length > 2000 ? `${value.slice(0, 2000)}...` : value;
}

function jsonForError(value: unknown): string {
  try {
    return truncateForError(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function suggestFromPromptError(message: string): string | undefined {
  const lower = message.toLowerCase();
  if (lower.includes('checkpoint') && (lower.includes('not found') || lower.includes('missing') || lower.includes('ckpt'))) {
    return 'Missing checkpoint. Suggested fix: place a .safetensors/.ckpt file in ComfyUI/models/checkpoints and confirm it appears in /object_info (CheckpointLoaderSimple.ckpt_name).';
  }
  if ((lower.includes('model') || lower.includes('lora') || lower.includes('vae')) && (lower.includes('not found') || lower.includes('missing'))) {
    return 'Missing model file. Suggested fix: verify required files exist under ComfyUI/models/* and confirm the loader node options via /object_info.';
  }
  if (lower.includes('invalid prompt') || lower.includes('prompt is invalid') || lower.includes('validation')) {
    return 'Invalid prompt/workflow JSON. Suggested fix: re-export the workflow from ComfyUI and ensure the MCP runner mappings match node IDs and input keys.';
  }
  return undefined;
}

export class ComfyUiClient {
  constructor(private readonly config: ResolvedConfig) {}

  private baseUrl(overrideUrl?: string): string {
    return overrideUrl ?? this.config.comfyui_url;
  }

  async healthCheck(): Promise<ComfyHealthResult> {
    try {
      const response = await fetchWithTimeout(`${this.config.comfyui_url}/history`, { method: 'GET' }, this.config.request_timeout_seconds);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return {
        reachable: true,
        status: 'ok',
        comfyui_url: this.config.comfyui_url,
        message: `ComfyUI is reachable at ${this.config.comfyui_url}.`,
      };
    } catch {
      return {
        reachable: false,
        status: 'unreachable',
        comfyui_url: this.config.comfyui_url,
        message: 'ComfyUI is not reachable. Make sure it is running at http://127.0.0.1:8188 or update config.json.',
      };
    }
  }

  async healthCheckUrl(comfyuiUrl: string): Promise<ComfyHealthResult> {
    try {
      const response = await fetchWithTimeout(`${comfyuiUrl}/history`, { method: 'GET' }, this.config.request_timeout_seconds);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return {
        reachable: true,
        status: 'ok',
        comfyui_url: comfyuiUrl,
        message: `ComfyUI is reachable at ${comfyuiUrl}.`,
      };
    } catch {
      return {
        reachable: false,
        status: 'unreachable',
        comfyui_url: comfyuiUrl,
        message: `ComfyUI is not reachable. Make sure it is running at ${comfyuiUrl} or update config.json.`,
      };
    }
  }

  async queuePrompt(prompt: JsonObject, comfyuiUrlOverride?: string): Promise<ComfyQueueResult> {
    const base = this.baseUrl(comfyuiUrlOverride);
    const response = await fetchWithTimeout(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    }, this.config.request_timeout_seconds);

    if (!response.ok) {
      const rawBody = await response.text().catch(() => '');
      const body = truncateForError(rawBody);
      const suggestion = rawBody ? suggestFromPromptError(rawBody) : undefined;
      throw new Error(
        `ComfyUI prompt submission failed. Cause: HTTP ${response.status} ${response.statusText}${body ? `; response: ${body}` : ''}. ` +
        `Suggested fix: ${suggestion ?? 'check the workflow JSON and ComfyUI server logs.'}`,
      );
    }

    const body = await response.json() as JsonObject;
    if (typeof body.prompt_id !== 'string' || body.prompt_id.length === 0) {
      throw new Error(`ComfyUI prompt submission failed. Cause: response did not contain prompt_id; response: ${jsonForError(body)}. Suggested fix: inspect the ComfyUI API response and verify the workflow format.`);
    }

    return { prompt_id: body.prompt_id, raw_response: body };
  }

  async getObjectInfo(comfyuiUrlOverride?: string): Promise<JsonObject> {
    const base = this.baseUrl(comfyuiUrlOverride);
    const response = await fetchWithTimeout(`${base}/object_info`, { method: 'GET' }, this.config.request_timeout_seconds);
    if (!response.ok) {
      const body = truncateForError(await response.text().catch(() => ''));
      throw new Error(`ComfyUI object_info request failed. Cause: HTTP ${response.status} ${response.statusText}${body ? `; response: ${body}` : ''}. Suggested fix: ensure ComfyUI is running and supports /object_info.`);
    }
    return await response.json() as JsonObject;
  }

  async getPromptHistory(promptId: string, comfyuiUrlOverride?: string): Promise<JsonObject> {
    const base = this.baseUrl(comfyuiUrlOverride);
    const response = await fetchWithTimeout(`${base}/history/${promptId}`, { method: 'GET' }, this.config.request_timeout_seconds);
    if (!response.ok) {
      throw new Error(`ComfyUI history request failed. Cause: HTTP ${response.status} ${response.statusText}. Suggested fix: check whether ComfyUI is still running.`);
    }
    return await response.json() as JsonObject;
  }

  async waitForPrompt(promptId: string, comfyuiUrlOverride?: string): Promise<JsonObject> {
    const started = Date.now();
    const maxWaitMs = timeoutMs(this.config.polling_timeout_seconds);
    const pollDelayMs = timeoutMs(this.config.polling_interval_seconds);
    let consecutiveNetworkErrors = 0;

    while (Date.now() - started < maxWaitMs) {
      try {
        const history = await this.getPromptHistory(promptId, comfyuiUrlOverride);
        consecutiveNetworkErrors = 0;
        if (history[promptId] || history.outputs) {
          return history;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/ECONNRESET|fetch failed|socket hang up/i.test(message)) {
          consecutiveNetworkErrors += 1;
          // Give ComfyUI time to recover if it restarted under memory pressure.
          if (consecutiveNetworkErrors >= 3) {
            const base = this.baseUrl(comfyuiUrlOverride);
            const health = await this.healthCheckUrl(base);
            if (!health.reachable) {
              throw new Error(`ComfyUI became unreachable while waiting for prompt '${promptId}'. Cause: network reset / server restart. Suggested fix: reduce model size, enable GPU, or increase system RAM.`);
            }
          }
        } else {
          throw error;
        }
      }
      await sleep(pollDelayMs);
    }

    throw new Error(`ComfyUI job timed out. Cause: prompt '${promptId}' did not complete within ${this.config.polling_timeout_seconds} seconds. Suggested fix: increase polling_timeout_seconds or simplify the workflow.`);
  }
}
