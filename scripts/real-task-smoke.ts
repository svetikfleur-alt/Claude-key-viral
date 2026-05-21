import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const projectRoot = process.cwd();
const logsDir = path.join(projectRoot, 'logs');
const smokeDir = path.join(logsDir, 'manual-smoke');

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  await fs.mkdir(smokeDir, { recursive: true });
  const stamp = nowStamp();
  const transcriptPath = path.join(smokeDir, `real-task-smoke-${stamp}.json`);

  const client = new Client({
    name: 'comfyui-mcp-runner-smoke',
    version: '1.0.0',
  });

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: projectRoot,
    stderr: 'pipe',
  });

  const serverStderr: string[] = [];
  transport.stderr?.on('data', (chunk) => {
    serverStderr.push(String(chunk));
  });

  const transcript: Record<string, unknown> = {
    started_at: new Date().toISOString(),
    cwd: projectRoot,
    tasks: [],
  };

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    (transcript.tasks as unknown[]).push({
      task: 'list_tools',
      result: tools.tools.map((tool) => tool.name),
    });

    const taskInputs = [
      { name: 'health_check_comfyui', arguments: {} },
      { name: 'list_comfyui_workflows', arguments: {} },
      { name: 'inspect_comfyui_workflow', arguments: { workflow_name: 'basic-image' } },
      {
        name: 'dry_run_comfyui_workflow',
        arguments: {
          workflow_name: 'basic-image',
          positive_prompt: 'a cinematic fox walking through foggy pines at dawn',
          negative_prompt: 'blurry, low quality, text, watermark',
          seed: 12345,
          width: 768,
          height: 512,
          extra_params: {
            steps: 28,
            cfg: 7.5,
          },
        },
      },
      {
        name: 'run_comfyui_workflow',
        arguments: {
          workflow_name: 'basic-image',
          positive_prompt: 'a cinematic fox walking through foggy pines at dawn',
          negative_prompt: 'blurry, low quality, text, watermark',
          seed: 12345,
          width: 768,
          height: 512,
          extra_params: {
            steps: 28,
            cfg: 7.5,
          },
        },
      },
      { name: 'list_recent_outputs', arguments: { limit: 5, type: 'all' } },
    ] as const;

    for (const task of taskInputs) {
      const result = await client.callTool({
        name: task.name,
        arguments: task.arguments,
      });

      (transcript.tasks as unknown[]).push({
        task: task.name,
        arguments: task.arguments,
        is_error: Boolean(result.isError),
        content: result.content,
        structured_content: result.structuredContent ?? null,
      });
    }
  } finally {
    await transport.close();
    transcript.finished_at = new Date().toISOString();
    transcript.server_stderr = serverStderr.join('');
    await fs.writeFile(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
    console.log(`Saved smoke transcript to ${transcriptPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
