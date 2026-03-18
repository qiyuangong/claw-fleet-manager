# Web Package

This package contains the React dashboard for Claw Fleet Manager.

## Local Setup

Create a local env file so the browser can authenticate against the Fastify server:

```bash
cp .env.example .env.local
```

Set the values to match `packages/server/server.config.json`:

```bash
VITE_BASIC_AUTH_USER=admin
VITE_BASIC_AUTH_PASSWORD=changeme
```

## Commands

```bash
npm run dev
npm run build
```
