/**
 * Platform Bootstrap
 *
 * Initializes all platform services and starts the HTTP server.
 * Called from the main MCP server entry point so both servers
 * run in the same process.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedConfig } from '../types.js';
import { AssetLibrary } from './assetLibrary.js';
import { JobRegistry } from './jobStore.js';
import { ProjectRegistry } from './projectStore.js';
import { MediaRouter } from './mediaRouter.js';
import { startHttpServer } from './httpServer.js';
import { registerPlatformMcpTools } from './mcpTools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PlatformServices {
  assetLibrary: AssetLibrary;
  jobRegistry: JobRegistry;
  projectRegistry: ProjectRegistry;
  mediaRouter: MediaRouter;
}

export async function startPlatform(
  config: ResolvedConfig,
  projectRoot: string,
  port = 3333,
  mcpServer?: McpServer,
): Promise<PlatformServices> {
  const outputsRoot = path.join(projectRoot, 'outputs');

  // Initialise stores
  const assetLibrary = new AssetLibrary(outputsRoot, projectRoot);
  const jobRegistry = new JobRegistry(outputsRoot);
  const projectRegistry = new ProjectRegistry(outputsRoot);

  // Initialise job registry (loads persisted history)
  await jobRegistry.init();

  // Initialise media router
  const mediaRouter = new MediaRouter({
    config,
    assetLibrary,
    jobRegistry,
    projectRoot,
  });

  const services: PlatformServices = { assetLibrary, jobRegistry, projectRegistry, mediaRouter };

  // Register MCP tools if a server was provided
  if (mcpServer) {
    registerPlatformMcpTools(mcpServer, services);
  }

  // Dashboard static files live in <projectRoot>/dashboard
  const dashboardDir = path.join(projectRoot, 'dashboard');

  // Start HTTP server
  await startHttpServer(
    {
      config,
      assetLibrary,
      jobRegistry,
      projectRegistry,
      mediaRouter,
      dashboardDir,
      projectRoot,
    },
    port,
  );

  console.log(`[platform] Dashboard: http://127.0.0.1:${port}`);
  console.log(`[platform] API:       http://127.0.0.1:${port}/api`);

  return services;
}
