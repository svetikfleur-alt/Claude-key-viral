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
      throw new Error(`ComfyUI prompt submission failed. Cause: HTTP ${response.status} ${response.statusText}. Suggested fix: check the workflow JSON and ComfyUI server logs.`);
    }

    const body = await response.json() as JsonObject;
    if (typeof body.prompt_id !== 'string' || body.prompt_id.length === 0) {
      throw new Error('ComfyUI prompt submission failed. Cause: response did not contain prompt_id. Suggested fix: inspect the ComfyUI API response and verify the workflow format.');
    }

    return { prompt_id: body.prompt_id, raw_response: body };
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
