import type { FleetInstance } from '../types.js';
import type { FastifyInstance } from 'fastify';

const STATUS_VALUES: Array<FleetInstance['status']> = [
  'running',
  'stopped',
  'restarting',
  'unhealthy',
  'unknown',
];

const MEMORY_ZERO = 0;

function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/"/g, '\\"');
}

function emitMetricHeader(lines: string[], name: string, type: 'gauge' | 'counter', help: string): void {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} ${type}`);
}

function emitLabeledMetric(
  lines: string[],
  name: string,
  labels: Record<string, string>,
  value: number,
): void {
  const labelText = Object.entries(labels)
    .map(([key, raw]) => `${key}="${escapeLabel(String(raw))}"`)
    .join(',');
  lines.push(`${name}{${labelText}} ${Number.isFinite(value) ? value : 0}`);
}

function emitSimpleMetric(lines: string[], name: string, value: number): void {
  lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/api/metrics', {
    schema: {
      tags: ['System'],
      summary: 'Prometheus metrics',
    },
  }, async (_request, reply) => {
    const status = app.backend.getCachedStatus()
      ?? await app.backend.refresh().catch(() => ({
        instances: [],
        totalRunning: 0,
        updatedAt: Date.now(),
      }));
    const lines: string[] = [];

    const totalInstances = status.instances.length;
    const runningInstances = status.totalRunning;
    const scrapeTimestamp = Date.now() / 1000;
    const runtimeCount = new Map<string, number>();
    const modeCount = new Map<string, number>();

    emitMetricHeader(lines, 'claw_fleet_instances', 'gauge', 'Total number of managed instances');
    emitSimpleMetric(lines, 'claw_fleet_instances', totalInstances);
    emitSimpleMetric(lines, 'claw_fleet_instances_running', runningInstances);

    emitMetricHeader(lines, 'claw_fleet_scrape_timestamp_seconds', 'gauge', 'Unix timestamp of the last scrape');
    emitSimpleMetric(lines, 'claw_fleet_scrape_timestamp_seconds', scrapeTimestamp);

    emitMetricHeader(
      lines,
      'claw_fleet_instance_status',
      'gauge',
      'Instance health status by runtime/mode; value is 1 when instance matches the status label.',
    );

    emitMetricHeader(
      lines,
      'claw_fleet_instance_cpu_percent',
      'gauge',
      'CPU usage percentage for each instance',
    );
    emitMetricHeader(
      lines,
      'claw_fleet_instance_memory_used_bytes',
      'gauge',
      'Memory currently used by each instance',
    );
    emitMetricHeader(
      lines,
      'claw_fleet_instance_memory_limit_bytes',
      'gauge',
      'Memory limit for each instance',
    );
    emitMetricHeader(
      lines,
      'claw_fleet_instance_disk_config_bytes',
      'gauge',
      'Config directory size for each instance',
    );
    emitMetricHeader(
      lines,
      'claw_fleet_instance_disk_workspace_bytes',
      'gauge',
      'Workspace directory size for each instance',
    );
    emitMetricHeader(
      lines,
      'claw_fleet_instance_uptime_seconds',
      'gauge',
      'Instance uptime in seconds',
    );

    for (const instance of status.instances) {
      const labels = {
        instance_id: instance.id,
        runtime: instance.runtime,
        mode: instance.mode,
      };

      runtimeCount.set(instance.runtime, (runtimeCount.get(instance.runtime) ?? 0) + 1);
      modeCount.set(instance.mode, (modeCount.get(instance.mode) ?? 0) + 1);

      for (const statusValue of STATUS_VALUES) {
        emitLabeledMetric(
          lines,
          'claw_fleet_instance_status',
          { ...labels, status: statusValue },
          instance.status === statusValue ? 1 : 0,
        );
      }

      emitLabeledMetric(lines, 'claw_fleet_instance_cpu_percent', labels, safeNumber(instance.cpu));
      emitLabeledMetric(
        lines,
        'claw_fleet_instance_memory_used_bytes',
        labels,
        safeNumber(instance.memory?.used, MEMORY_ZERO),
      );
      emitLabeledMetric(
        lines,
        'claw_fleet_instance_memory_limit_bytes',
        labels,
        safeNumber(instance.memory?.limit, MEMORY_ZERO),
      );
      emitLabeledMetric(
        lines,
        'claw_fleet_instance_disk_config_bytes',
        labels,
        safeNumber(instance.disk?.config, MEMORY_ZERO),
      );
      emitLabeledMetric(
        lines,
        'claw_fleet_instance_disk_workspace_bytes',
        labels,
        safeNumber(instance.disk?.workspace, MEMORY_ZERO),
      );
      emitLabeledMetric(lines, 'claw_fleet_instance_uptime_seconds', labels, safeNumber(instance.uptime, MEMORY_ZERO));
    }

    emitMetricHeader(
      lines,
      'claw_fleet_instances_by_runtime',
      'gauge',
      'Number of managed instances by runtime',
    );
    for (const [runtime, count] of runtimeCount.entries()) {
      emitLabeledMetric(lines, 'claw_fleet_instances_by_runtime', { runtime }, count);
    }

    emitMetricHeader(
      lines,
      'claw_fleet_instances_by_mode',
      'gauge',
      'Number of managed instances by mode',
    );
    for (const [mode, count] of modeCount.entries()) {
      emitLabeledMetric(lines, 'claw_fleet_instances_by_mode', { mode }, count);
    }

    reply.header('content-type', 'text/plain; version=0.0.4');
    return lines.join('\n') + '\n';
  });
}
