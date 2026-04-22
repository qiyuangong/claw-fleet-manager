# Security Policy

## Supported Versions

Claw Fleet Manager is in early development. Only the latest minor release
receives security updates.

| Version | Supported |
| ------- | :-------: |
| 0.1.x   | ✓         |
| < 0.1   | ✗         |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Use one of the following private channels instead:

1. **GitHub Security Advisories (preferred).** Open a private report at
   <https://github.com/qiyuangong/claw-fleet-manager/security/advisories/new>.
2. **Email.** Send details to the maintainer listed on the GitHub profile at
   <https://github.com/qiyuangong>.

Please include, if possible:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (proof-of-concept, affected routes, config snippets).
- Version or commit SHA you tested against.
- Any suggested mitigation or patch.

You can expect an initial acknowledgement within **7 days** and a status
update within **30 days**. We will coordinate a fix and disclosure timeline
with you before any public announcement.

## Scope

In scope:

- The Fastify API server in `packages/server` (auth, authorization,
  WebSocket and proxy routes, fleet config handling).
- The React dashboard in `packages/web` (auth flows, token handling,
  Control UI iframe/popup integration).
- Default Docker deployment assets under `scripts/` and `Dockerfile`.
- Runtime file handling (`users.json`, `profiles.json`, per-instance
  `openclaw.json`, Tailscale state).

Out of scope:

- Vulnerabilities in upstream dependencies (OpenClaw, Hermes, Docker,
  Tailscale, Fastify, React). Report those to the respective projects.
- Issues that require physical access to the host or a pre-compromised
  administrator account.
- Self-inflicted misconfiguration (e.g. exposing the default admin
  credentials `admin` / `changeme` to the public internet without TLS).

## Deployment Hardening

Before exposing a deployment beyond `localhost`:

- Change the bootstrap `auth.username` / `auth.password` in
  `packages/server/server.config.json` and rotate web `VITE_BASIC_AUTH_*`
  values to match.
- Enable TLS via the `tls` block in `server.config.json`, or front the
  server with a reverse proxy that terminates TLS.
- Restrict network access to trusted operators or use Tailscale for
  remote Control UI access.
- Back up `fleetDir/users.json` and per-instance `openclaw.json`
  separately from the runtime directory.
- Keep the manager and its runtime host patched; subscribe to this
  repository for release notifications.

## Credit

We are happy to credit reporters in release notes once a fix ships, unless
you request otherwise.
