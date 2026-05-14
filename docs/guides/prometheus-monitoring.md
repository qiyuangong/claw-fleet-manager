# Prometheus Monitoring

Claw Fleet Manager now exposes fleet metrics at:

- `GET /api/metrics`

The response follows the Prometheus text format (`text/plain; version=0.0.4`) and is generated from the same in-memory status data already used by the dashboard (`/api/fleet`).

## What is exposed

The endpoint exposes:

- Fleet-wide counters:
  - `claw_fleet_instances` — total instances
  - `claw_fleet_instances_running` — currently running instances
  - `claw_fleet_scrape_timestamp_seconds` — server-side scrape timestamp
- Per-instance gauges:
  - `claw_fleet_instance_cpu_percent`
  - `claw_fleet_instance_memory_used_bytes`
  - `claw_fleet_instance_memory_limit_bytes`
  - `claw_fleet_instance_disk_config_bytes`
  - `claw_fleet_instance_disk_workspace_bytes`
  - `claw_fleet_instance_uptime_seconds`
  - `claw_fleet_instance_status` with label `status` = one of `running|stopped|restarting|unhealthy|unknown`
- Aggregation gauges:
  - `claw_fleet_instances_by_runtime`
  - `claw_fleet_instances_by_mode`

Common labels for per-instance metrics:

- `instance_id`
- `runtime` (`openclaw` | `hermes`)
- `mode` (`docker` | `profile`)

For `claw_fleet_instance_status`, the metric value is `1` only for the matching `status` label value and `0` for others.

## Authentication

`/api/metrics` is under `/api`, so it is protected by existing Basic Auth used by manager endpoints.

If your Prometheus server cannot handle the auth flow directly, expose a scrape-only path via a reverse proxy or use a custom scrape config that sends credentials.

## Example Prometheus scrape config

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: claw-fleet-manager
    metrics_path: /api/metrics
    static_configs:
      - targets: ['fleet-manager:3001']
    basic_auth:
      username: admin
      password: changeme
```

Example with TLS:

```yaml
scrape_configs:
  - job_name: claw-fleet-manager
    metrics_path: /api/metrics
    scheme: https
    static_configs:
      - targets: ['fleet-manager:3443']
    tls_config:
      insecure_skip_verify: true
    basic_auth:
      username: admin
      password_file: /etc/prometheus/credentials/fleet-manager.txt
```

## Operational notes

- No new dependency is required on the manager side.
- The payload is rebuilt on each scrape from the latest cached status.
- If the status cache is temporarily unavailable, the endpoint returns zero-value defaults so Prometheus remains scrapeable.

## Quick verification

```bash
curl -u admin:changeme http://localhost:3001/api/metrics | head
```

You should see Prometheus `# HELP` and `# TYPE` entries followed by metric lines.

## Future work (optional)

- Add Grafana dashboards for the new series
- Add alerting examples for instance down/fail states
- Add a separate unauthenticated scrape endpoint behind a trusted reverse proxy
