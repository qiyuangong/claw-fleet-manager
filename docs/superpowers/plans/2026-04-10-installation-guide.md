# Installation Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a macOS-focused local installation guide for internal users, plus README discoverability, without turning the guide into a contributor or deployment manual.

**Architecture:** Create a single Markdown guide at `docs/guides/installation-guide.md` that mirrors the tone and sectioned task format of the existing admin guide, but uses command-line and config-file steps instead of screenshots. Update `README.md` so the new guide is visible from the top navigation and from the docs callout near the architecture section.

**Tech Stack:** Markdown, existing repo docs, npm/Turbo monorepo commands, local config files under `packages/server/` and `packages/web/`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `docs/guides/installation-guide.md` | Main local setup guide for internal macOS users |
| Modify | `README.md` | Add installation-guide links so readers can discover the new doc |

---

### Task 1: Draft the guide shell and setup entry sections

**Files:**
- Create: `docs/guides/installation-guide.md`

- [ ] **Step 1: Create the guide shell with title, intro, and table of contents**

Write `docs/guides/installation-guide.md`:

```markdown
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
```

- [ ] **Step 2: Add the overview and prerequisites sections**

Append to `docs/guides/installation-guide.md`:

````markdown
## 0. Overview

Use this guide when you need to run Claw Fleet Manager locally on macOS and do not need contributor-level setup details.

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
- Node.js
- `openclaw`

For `openclaw` installation, follow the official OpenClaw docs:

- [Install OpenClaw](https://docs.openclaw.ai/install)

**Optional for Docker-backed instances only:**

- Docker Desktop

> **Important:** This guide assumes `openclaw` is already available in your shell `PATH`. If `openclaw --version` fails, fix that first before continuing.

---
````

- [ ] **Step 3: Commit the guide shell**

```bash
git add docs/guides/installation-guide.md
git commit -m "docs: scaffold local installation guide"
```

Expected: one new guide file committed.

---

### Task 2: Add the local setup and run workflow

**Files:**
- Modify: `docs/guides/installation-guide.md`

- [ ] **Step 1: Add repository checkout and dependency installation sections**

Append to `docs/guides/installation-guide.md`:

````markdown
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
````

- [ ] **Step 2: Add server config, TLS, web env, and start sections**

Append to `docs/guides/installation-guide.md`:

````markdown
## 4. Create the Server Config

Use this section to create the minimum local server configuration.

**Steps:**

1. Copy the example config:

   ```bash
   cp packages/server/server.config.example.json packages/server/server.config.json
   ```

2. Open `packages/server/server.config.json` in your editor.

3. Set the required fields:

   - `fleetDir`: the path to your OpenClaw fleet directory
   - `auth.username` and `auth.password`: the local admin account you will use to sign in
   - `tls.cert` and `tls.key`: the certificate paths you will create in the next section

4. If you want native profile instances, add the `profiles` block from the example config and update the values for your machine.

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

> **Note:** Your browser will show a warning the first time you open the app with a self-signed certificate. That is expected in local setup.

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

If you removed TLS from your server config, the API will run on `http://localhost:3001` instead.

---
````

- [ ] **Step 3: Commit the setup workflow**

```bash
git add docs/guides/installation-guide.md
git commit -m "docs: add local setup workflow"
```

Expected: the guide covers setup from clone through startup.

---

### Task 3: Add first-run checks, shutdown, troubleshooting, and README links

**Files:**
- Modify: `docs/guides/installation-guide.md`
- Modify: `README.md`

- [ ] **Step 1: Add the first-login, stop, and troubleshooting sections**

Append to `docs/guides/installation-guide.md`:

````markdown
## 8. First Login and Sanity Check

Use this section to confirm the setup works end to end.

**Steps:**

1. Open `http://localhost:5173` in your browser.
2. If the browser warns about the self-signed certificate, accept it for local use.
3. Sign in with the username and password you set in `packages/server/server.config.json`.
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

Likely cause: the credentials in `packages/web/.env.local` do not match `packages/server/server.config.json`.

Fix: make the values match exactly, then restart `npm run dev`.

### `openclaw: command not found`

Likely cause: OpenClaw is not installed or is not in your shell `PATH`.

Fix: install OpenClaw from the official docs, then confirm `openclaw --version` works.

### Docker-backed instances do not work

Likely cause: Docker Desktop is not running, or the configured image tag is not available locally.

Fix: start Docker Desktop and confirm the expected OpenClaw image tag exists locally.
````

- [ ] **Step 2: Add installation-guide links to `README.md`**

Update the top link row in `README.md` to:

```html
<p align="center">
  <a href="README_CN.md">简体中文</a> ·
  <a href="docs/arch/README.md">Architecture</a> ·
  <a href="docs/guides/installation-guide.md">Installation Guide</a> ·
  <a href="docs/guides/admin-guide.md">Admin Guide</a> ·
  <a href="docs/guides/admin-quick-reference.md">Quick Reference</a>
</p>
```

Update the docs sentence near the architecture section in `README.md` to:

```markdown
See [docs/arch/README.md](docs/arch/README.md) for the full architecture walkthrough.

For local setup, see [docs/guides/installation-guide.md](docs/guides/installation-guide.md). For day-to-day admin workflows, see [docs/guides/admin-guide.md](docs/guides/admin-guide.md) and the [quick reference](docs/guides/admin-quick-reference.md).
```

- [ ] **Step 3: Commit the guide completion and README links**

```bash
git add docs/guides/installation-guide.md README.md
git commit -m "docs: add local installation guide"
```

Expected: the new guide is discoverable from the main README.

---

### Task 4: Verify the guide against the source docs and repo paths

**Files:**
- Modify: `docs/guides/installation-guide.md` (only if fixes are needed)
- Modify: `README.md` (only if fixes are needed)

- [ ] **Step 1: Re-read the new guide and README links**

Run:

```bash
sed -n '1,260p' docs/guides/installation-guide.md
sed -n '1,80p' README.md
```

Expected:
- section order matches the approved design
- links point to existing docs
- commands and file paths are formatted consistently

- [ ] **Step 2: Cross-check commands and paths against the current repo**

Run:

```bash
test -f packages/server/server.config.example.json
test -f packages/web/.env.example
rg -n "Dashboard runs at|API server at|openssl req -x509" README.md
```

Expected:
- both referenced example files exist
- the guide’s start URLs and TLS command match the current README

- [ ] **Step 3: Fix any drift found during verification**

If any commands, paths, or URLs do not match the repo, update the guide immediately before finishing.

Example correction block:

```markdown
- Dashboard: `http://localhost:5173`
- API server: `https://localhost:3001`
```

- [ ] **Step 4: Commit verification fixes if needed**

```bash
git add docs/guides/installation-guide.md README.md
git commit -m "docs: align installation guide with verified setup commands"
```

Expected: no uncommitted doc fixes remain after verification.
