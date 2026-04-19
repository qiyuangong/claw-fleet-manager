# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-19

Initial public release of Claw Fleet Manager — a web UI and API server for
operating a hybrid fleet of OpenClaw and Hermes gateway instances.

### Added

#### Fleet management
- Hybrid backend supporting OpenClaw profile instances, OpenClaw Docker
  instances, and Hermes Docker instances from a single control plane.
- Unified fleet list with shared lifecycle actions: start, stop, restart,
  create, remove, and in-place rename.
- Migration between profile and Docker deployments for OpenClaw instances.
- Auto-restart on crash for profile-mode instances.
- Hermes Docker runtime support with automatic hiding of OpenClaw-only features.

#### Dashboard and observability
- Admin dashboard with fleet overview and health metrics.
- Running sessions monitor page and per-instance activity/sessions tab.
- Session history persistence with URL-driven filters.
- Live log streaming over WebSocket with reconnect indication.
- Per-instance CPU, memory, and disk metrics (Recharts).

#### Configuration and plugins
- Per-instance config editor (Monaco) with validation.
- Fleet-wide config panel.
- Plugin install / uninstall for OpenClaw instances.
- Device approval and Feishu pairing for OpenClaw Control UI.

#### Control UI integration
- Embedded Control UI tab via reverse proxy with token injection.
- Cookie- and proxy-token-based sub-resource auth for iframe and popup flows.
- Per-instance Tailscale HTTPS URLs for remote Control UI access.
- TLS support for the embedded manager server.

#### Auth and access control
- Basic Auth for the HTTP API with admin and user roles.
- WebSocket and proxy bootstrap via `?auth=<base64(user:pass)>`.
- Profile-scoped authorization for non-admin users.
- Multi-user management UI for admins.
- Default seeded non-admin `testuser` for first-run deployments.

#### Deployment
- Docker deployment via `scripts/docker-deploy.sh` with TLS, overrides, and
  per-instance data roots.
- Self-sufficient Docker mode (no external compose required).
- Native profile mode with per-instance workspace, state, and config
  directories under configurable profile base paths.

#### Developer experience
- Turbo-driven monorepo (`packages/server`, `packages/web`).
- Fastify 5 API server with Zod validation and OpenAPI (Swagger UI) docs.
- React 19 + Vite 8 dashboard with React Query, Zustand, and i18n
  (English + Simplified Chinese).
- Vitest unit tests for server and web.
- Playwright end-to-end smoke tests.
- Shared `LockManager` across the three backends.

#### Documentation
- Bilingual README (English / Simplified Chinese).
- Installation, Docker deployment, admin, quick-reference, and development
  guides in both languages.
- Architecture documentation with diagrams.
- Screenshots gallery and UI walkthrough.

[0.1.0]: https://github.com/qiyuangong/claw-fleet-manager/releases/tag/v0.1.0
