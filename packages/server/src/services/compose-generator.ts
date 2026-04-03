import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { FleetConfigService } from './fleet-config.js';
import type { TailscaleConfig } from '../types.js';

const BASE_GW_PORT = 18789;

export class ComposeGenerator {
  private fleetConfig: FleetConfigService;

  constructor(private fleetDir: string) {
    this.fleetConfig = new FleetConfigService(fleetDir);
  }

  generate(count: number, tailscaleConfig?: TailscaleConfig): void {
    const vars = this.fleetConfig.readFleetEnvRaw();
    const portStep = parseInt(vars.PORT_STEP ?? '20', 10);
    const cpuLimit = vars.CPU_LIMIT ?? '4';
    const memLimit = vars.MEM_LIMIT ?? '8G';
    const configBase = vars.CONFIG_BASE ?? join(process.env.HOME ?? '', 'openclaw-instances');
    const workspaceBase = vars.WORKSPACE_BASE ?? join(process.env.HOME ?? '', 'openclaw-workspaces');
    const existingTokens = this.fleetConfig.readTokens();
    const tokens: Record<number, string> = {};
    const maxExistingIndex = Math.max(0, ...Object.keys(existingTokens).map((key) => parseInt(key, 10)));
    const tokenCount = Math.max(count, maxExistingIndex);

    for (let i = 1; i <= tokenCount; i += 1) {
      tokens[i] = existingTokens[i] ?? randomBytes(32).toString('hex');
      if (i <= count) {
        mkdirSync(join(configBase, String(i)), { recursive: true });
        mkdirSync(join(workspaceBase, String(i)), { recursive: true });

        const configFile = join(configBase, String(i), 'openclaw.json');
        if (!existsSync(configFile)) {
          const gwPort = BASE_GW_PORT + (i - 1) * portStep;
          const baseUrl = vars.BASE_URL ?? '';
          const apiKey = vars.API_KEY ?? '';
          const modelId = vars.MODEL_ID ?? '';

          const openclawConfig: Record<string, unknown> = {
            gateway: {
              mode: 'local',
              auth: { mode: 'token', token: tokens[i] },
              controlUi: {
                allowedOrigins: [
                  `http://127.0.0.1:${gwPort}`,
                  `http://localhost:${gwPort}`,
                ],
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

          if (tailscaleConfig) {
            const tsPort = tailscaleConfig.portMap.get(i);
            if (tsPort !== undefined) {
              const gw = openclawConfig.gateway as Record<string, unknown>;
              const auth = gw.auth as Record<string, unknown>;
              auth.allowTailscale = true;
              const controlUi = gw.controlUi as Record<string, unknown>;
              controlUi.allowInsecureAuth = true;
              (openclawConfig.gateway as any).controlUi.allowedOrigins.push(
                `https://${tailscaleConfig.hostname}:${tsPort}`,
              );
            }
          }

          writeFileSync(configFile, JSON.stringify(openclawConfig, null, 2) + '\n');
        }
      }
    }

    const envLines = Object.entries(tokens).map(([idx, token]) => `TOKEN_${idx}=${token}`);
    writeFileSync(join(this.fleetDir, '.env'), envLines.join('\n') + '\n');

    const services: string[] = [];
    for (let i = 1; i <= count; i += 1) {
      const service = `openclaw-${i}`;
      const gwPort = BASE_GW_PORT + (i - 1) * portStep;
      const configDir = join(configBase, String(i));
      const workspaceDir = join(workspaceBase, String(i));

      services.push(`  ${service}:
    image: \${OPENCLAW_IMAGE:-openclaw:local}
    pull_policy: never
    container_name: ${service}
    networks:
      - net-${service}
    environment:
      HOME: /home/node
      TERM: xterm-256color
      OPENCLAW_GATEWAY_TOKEN: "\${TOKEN_${i}}"
      TZ: "\${TZ:-Asia/Shanghai}"
    volumes:
      - ${configDir}:/home/node/.openclaw
      - ${workspaceDir}:/home/node/.openclaw/workspace
    ports:
      - "${gwPort}:18789"
    deploy:
      resources:
        limits:
          cpus: "${cpuLimit}"
          memory: ${memLimit}
    init: true
    restart: unless-stopped
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    command:
      ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789"]
    healthcheck:
      test:
        ["CMD", "node", "-e",
         "fetch('http://127.0.0.1:18789/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s`);
    }

    const networks = Array.from(
      { length: count },
      (_, i) => `  net-openclaw-${i + 1}:\n    driver: bridge`,
    ).join('\n');

    const compose = `# Auto-generated by claw-fleet-manager -- do not edit manually
services:
${services.join('\n\n')}

networks:
${networks}
`;

    writeFileSync(join(this.fleetDir, 'docker-compose.yml'), compose);
  }
}
