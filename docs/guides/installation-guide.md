# Claw Fleet Manager — Local Installation Guide (macOS)

This guide helps internal macOS users run **Claw Fleet Manager** locally for the first time.
It focuses on setup and first launch, not contributor workflows or production deployment.

> **After setup:** Use the [Administrator Guide](admin-guide.md) for day-to-day dashboard tasks.

---

## Table of Contents

- [0. Overview](#0-overview)
- [1. Prerequisites](#1-prerequisites)
- [2. Get the Code](#2-get-the-code)
- [3. Install Project Dependencies](#3-install-project-dependencies)
- [4. Create the Server Config](#4-create-the-server-config)
- [5. Generate Local TLS Certificates](#5-generate-local-tls-certificates)
- [6. Create the Web Env File](#6-create-the-web-env-file)
- [7. Start the Dashboard](#7-start-the-dashboard)
- [8. First Login and Sanity Check](#8-first-login-and-sanity-check)
- [9. Stop the App](#9-stop-the-app)
- [10. Troubleshooting](#10-troubleshooting)

---

## 0. Overview

Use this guide when you need to run Claw Fleet Manager locally on macOS and do not need setup details for contributors.

This guide covers:

- cloning the repository
- installing project dependencies
- creating the local config files
- starting the dashboard
- signing in for the first time

This guide does **not** cover:

- Homebrew installation
- Git installation
- Node.js installation
- full `openclaw` installation instructions
- production deployment

---

## 1. Prerequisites

Before you start, make sure these are already installed on your Mac:

- Homebrew
- Git
- Node.js 20+
- `openclaw`

For `openclaw` installation, follow the official OpenClaw docs:

- [Install OpenClaw](https://docs.openclaw.ai/install)

**Optional if you plan to use Docker later:**

- Docker Desktop

> **Important:** This guide assumes `openclaw` is already available in your shell `PATH`. If `openclaw --version` fails, fix that first before continuing.

---

## 2. Get the Code

Use this section to put the project on your machine in a known location.

**Steps:**

1. Clone the repository:

   ```bash
   git clone https://github.com/qiyuangong/claw-fleet-manager.git
   ```

2. Change into the project directory:

   ```bash
   cd claw-fleet-manager
   ```

3. Confirm you are in the repository root:

   ```bash
   pwd
   ls
   ```

---

## 3. Install Project Dependencies

Use this section to install the JavaScript dependencies needed to run the dashboard locally.

**Steps:**

1. Run:

   ```bash
   npm install
   ```

2. Wait until installation completes without errors.

**Optional: Docker-backed instances**

You do **not** need Docker just to launch the dashboard itself.

If you plan to use Docker-backed instances later:

- make sure Docker Desktop is installed and running
- make sure you have an OpenClaw image available locally
- the default local image tag used by the fleet manager is `openclaw:local`

---

## 4. Create the Server Config

Use this section to create the minimum local server configuration.

**Steps:**

1. Copy the example config:

   ```bash
   cp packages/server/server.config.example.json packages/server/server.config.json
   ```

2. Open `packages/server/server.config.json` in your editor.

3. Create the directory that `fleetDir` points to before first launch. For the example path above, run:

   ```bash
   mkdir -p /Users/your-name/openclaw-fleet
   ```

4. Set the required fields:

   - `fleetDir`: the folder where your OpenClaw fleet data lives, for example `/Users/your-name/openclaw-fleet`
   - `auth.username` and `auth.password`: the local admin account you will use to sign in
   - set `seedTestUser` to `true` only for local/dev if you want `testuser` seeded as a normal user with password `testuser`
   - `tls.cert` and `tls.key`: the certificate paths you will create in the next section

   > Production hardening checklist:
   > 1. Set `auth.password` to a strong value.
   > 2. If `seedTestUser` is enabled, delete seeded `testuser` as admin:
   >    ```bash
   >    curl -k -u admin:NEW_ADMIN_PASSWORD -X DELETE https://localhost:3001/api/users/testuser
   >    ```
   > 3. Alternatively, delete `testuser` from `${fleetDir}/users.json` and restart.

5. If you do not plan to use Tailscale for this local setup, remove the `tailscale` block from the example config.

6. Profile instances already work with the built-in defaults. If you want to customize those settings, copy the `_profiles` block from the example config, rename it to `profiles`, and update the values for your machine. `openclawBinary` is the command the server should run for OpenClaw, the port settings control which local ports profile instances use, and `stateBaseDir` plus `configBaseDir` are the folders where those profile instances store their local state and config files.

> **Note:** Avoid using `main` as a profile name. OpenClaw reserves that name for the standalone default profile.

---

## 5. Generate Local TLS Certificates

Use this section to create a self-signed local certificate.

TLS is required because the Control UI authentication flow needs a secure browser context.

**Steps:**

1. Run:

   ```bash
   openssl req -x509 -newkey rsa:4096 -nodes -days 365 \
     -keyout key.pem -out cert.pem \
     -subj "/CN=localhost" \
     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
   ```

2. Save `cert.pem` and `key.pem` somewhere easy to find.

3. Update `packages/server/server.config.json` so:

   - `tls.cert` points to `cert.pem`
   - `tls.key` points to `key.pem`

> **Note:** If you open `https://localhost:3001` directly, or otherwise encounter the self-signed API certificate, your browser may show a warning. Accept it for local development and continue.

---

## 6. Create the Web Env File

Use this section to make the web app send the same basic auth credentials as the server.

**Steps:**

1. Copy the example env file:

   ```bash
   cp packages/web/.env.example packages/web/.env.local
   ```

2. Open `packages/web/.env.local`.

3. Set:

   - `VITE_BASIC_AUTH_USER`
   - `VITE_BASIC_AUTH_PASSWORD`

4. Make sure those values exactly match `auth.username` and `auth.password` in `packages/server/server.config.json`.

---

## 7. Start the Dashboard

Use this section to launch the local server and web app together.

**Steps:**

1. Start the app:

   ```bash
   npm run dev
   ```

2. Wait for both dev processes to come up.

3. Open the dashboard in your browser:

   - Dashboard: `http://localhost:5173`
   - API server: `https://localhost:3001`

---

## 8. First Login and Sanity Check

Use this section to confirm the setup works end to end.

**Steps:**

1. Open `http://localhost:5173` in your browser.
2. If `.env.local` is configured correctly, the dashboard may sign you in automatically; if it prompts, use the username and password from your current local setup.
3. If the browser warns about the self-signed API certificate, accept it for local use.
4. Confirm the dashboard loads successfully.

**Optional sanity check:**

- open the admin dashboard and confirm the main layout loads
- if you already have fleet data configured, confirm existing instances appear

---

## 9. Stop the App

Use this section when you are finished with the local session.

**Steps:**

1. Return to the terminal where `npm run dev` is running.
2. Press `Ctrl+C`.

---

## 10. Troubleshooting

### `npm: command not found`

Likely cause: Node.js is not installed correctly.

Fix: install or repair Node.js, then confirm `node --version` and `npm --version` both work.

### Port already in use

Likely cause: another local process is already using port `5173` or `3001`.

Fix: stop the conflicting process, then run `npm run dev` again.

### Browser warns about the certificate

Likely cause: you are using a self-signed local certificate.

Fix: accept the warning for local development and continue.

### Login fails or API requests do not work

Likely cause: the active login credentials do not match the current local setup, or this fleet is already using `fleetDir/users.json`.

Fix: for a first run, match `packages/server/server.config.json`; otherwise verify the existing `fleetDir/users.json`, then restart `npm run dev`.

### `openclaw: command not found`

Likely cause: OpenClaw is not installed or is not in your shell `PATH`.

Fix: install OpenClaw from the official docs, then confirm `openclaw --version` works.

### Docker-backed instances do not work

Likely cause: Docker Desktop is not running, or the configured image tag is not available locally.

Fix: start Docker Desktop and confirm the expected OpenClaw image tag exists locally.
