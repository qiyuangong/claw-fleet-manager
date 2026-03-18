# Claw Fleet Manager

Web management UI for an `openclaw` fleet. The project is split into:

- `packages/server`: Fastify API, Docker orchestration, config IO, log streaming
- `packages/web`: React dashboard for fleet status, lifecycle control, config editing, and logs

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Create a server config:

```bash
cp packages/server/server.config.example.json packages/server/server.config.json
```

3. Edit `packages/server/server.config.json` and point `fleetDir` at your actual `claw-fleet/openclaw` directory.

4. Create a web env file:

```bash
cp packages/web/.env.example packages/web/.env.local
```

5. Set `VITE_BASIC_AUTH_USER` and `VITE_BASIC_AUTH_PASSWORD` in `packages/web/.env.local` to match the server config.

6. Start both packages:

```bash
npm run dev
```

The Vite app runs on `http://localhost:5173` and proxies API and WebSocket traffic to the server on `http://localhost:3001`.

## Build

```bash
npm run build
```

## Test

```bash
cd packages/server
npx vitest run
```
