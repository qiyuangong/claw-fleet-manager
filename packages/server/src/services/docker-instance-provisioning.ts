import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TailscaleConfig } from '../types.js';

const BASE_GW_PORT = 18789;

const WORKSPACE_GITIGNORE = `node_modules/
dist/
.turbo/
*.tsbuildinfo
server.config.json
certs/
.superpowers/
.env.local
.worktrees/
`;
const WORKSPACE_CLAUDE_MD = `# CLAUDE.md

Docker-managed workspace for OpenClaw docker mode.
`;
const WORKSPACE_MEMORY_MD = `# MEMORY.md

## Notes

- Add instance-specific working notes here.
`;

interface DockerProvisionInput {
  index: number;
  portStep: number;
  configBase: string;
  workspaceBase: string;
  vars: Record<string, string>;
  token: string;
  tailscaleConfig?: TailscaleConfig;
  configOverride?: object;
}

export function provisionDockerInstance(input: DockerProvisionInput): void {
  const configDir = join(input.configBase, String(input.index));
  const workspaceDir = join(input.workspaceBase, String(input.index));
  const configFile = join(configDir, 'openclaw.json');

  mkdirSync(configDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  seedWorkspaceFiles(workspaceDir);

  if (existsSync(configFile)) {
    return;
  }

  const gwPort = BASE_GW_PORT + (input.index - 1) * input.portStep;
  const baseUrl = input.vars.BASE_URL ?? '';
  const apiKey = input.vars.API_KEY ?? '';
  const modelId = input.vars.MODEL_ID ?? '';

  const openclawConfig: Record<string, unknown> = {
    gateway: {
      mode: 'local',
      auth: { mode: 'token', token: input.token },
      controlUi: {
        allowedOrigins: [
          `http://127.0.0.1:${gwPort}`,
          `http://localhost:${gwPort}`,
        ],
      },
    },
    agents: {
      defaults: {
        workspace: '/home/node/.openclaw/workspace',
      },
    },
  };

  if (baseUrl && modelId) {
    openclawConfig.models = {
      mode: 'merge',
      providers: {
        default: {
          baseUrl,
          apiKey,
          api: 'openai-completions',
          models: [{ id: modelId, name: modelId }],
        },
      },
    };
  }

  if (input.tailscaleConfig) {
    const tsPort = input.tailscaleConfig.portMap.get(input.index);
    if (tsPort !== undefined) {
      const gw = openclawConfig.gateway as Record<string, unknown>;
      const auth = gw.auth as Record<string, unknown>;
      auth.allowTailscale = true;
      const controlUi = gw.controlUi as Record<string, unknown>;
      controlUi.allowInsecureAuth = true;
      (controlUi.allowedOrigins as string[]).push(
        `https://${input.tailscaleConfig.hostname}:${tsPort}`,
      );
    }
  }

  if (input.configOverride) {
    Object.assign(openclawConfig, input.configOverride);
  }

  writeFileSync(configFile, JSON.stringify(openclawConfig, null, 2) + '\n');
}

function seedWorkspaceFiles(workspaceDir: string): void {
  const seeds: Array<[string, string]> = [
    ['.gitignore', WORKSPACE_GITIGNORE],
    ['CLAUDE.md', WORKSPACE_CLAUDE_MD],
    ['MEMORY.md', WORKSPACE_MEMORY_MD],
  ];

  for (const [name, content] of seeds) {
    const path = join(workspaceDir, name);
    if (!existsSync(path)) {
      writeFileSync(path, content, 'utf-8');
    }
  }
}
