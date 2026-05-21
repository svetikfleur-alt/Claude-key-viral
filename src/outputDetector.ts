import path from 'node:path';
import type { JsonObject, OutputDetectionResult, OutputFileRecord, OutputGroup } from './types.js';

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const videoExtensions = new Set(['.mp4', '.webm']);

function classifyOutput(filename?: string): OutputGroup {
  const extension = filename ? path.extname(filename).toLowerCase() : '';
  if (imageExtensions.has(extension)) return 'image';
  if (videoExtensions.has(extension)) return 'video';
  return 'other';
}

function normalizeHistoryEntry(historyResponse: JsonObject, promptId: string): JsonObject | undefined {
  if (historyResponse[promptId] && typeof historyResponse[promptId] === 'object') {
    return historyResponse[promptId] as JsonObject;
  }
  if (historyResponse.outputs && typeof historyResponse.outputs === 'object') {
    return historyResponse;
  }
  return undefined;
}

export function detectOutputsFromHistory(historyResponse: JsonObject, promptId: string): OutputDetectionResult {
  const historyEntry = normalizeHistoryEntry(historyResponse, promptId);
  if (!historyEntry) {
    return { images: [], videos: [], other: [], warnings: [`Prompt '${promptId}' has no history entry yet.`] };
  }

  const outputs = historyEntry.outputs;
  if (!outputs || typeof outputs !== 'object') {
    return { images: [], videos: [], other: [], warnings: [`Prompt '${promptId}' finished without an outputs object.`] };
  }

  const grouped: OutputDetectionResult = { images: [], videos: [], other: [], warnings: [] };

  for (const [nodeId, nodeOutput] of Object.entries(outputs as JsonObject)) {
    if (!nodeOutput || typeof nodeOutput !== 'object') continue;
    for (const bucket of ['images', 'videos', 'audio', 'gifs', 'files']) {
      const items = (nodeOutput as JsonObject)[bucket];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as JsonObject;
        const filename = typeof raw.filename === 'string' ? raw.filename : undefined;
        const subfolder = typeof raw.subfolder === 'string' ? raw.subfolder : undefined;
        const type = classifyOutput(filename);
        const record: OutputFileRecord = {
          type,
          path: filename ? path.posix.join(subfolder ?? '', filename) : bucket,
          filename,
          subfolder,
          format: typeof raw.format === 'string' ? raw.format : undefined,
          source_node_id: nodeId,
          raw,
        };

        if (type === 'image') grouped.images.push(record);
        else if (type === 'video') grouped.videos.push(record);
        else grouped.other.push(record);
      }
    }
  }

  if (grouped.images.length === 0 && grouped.videos.length === 0 && grouped.other.length === 0) {
    grouped.warnings.push(`Prompt '${promptId}' completed but no output file records were found in history.`);
  }

  return grouped;
}
