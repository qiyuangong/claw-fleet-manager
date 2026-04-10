# Installation Guide Design — Claw Fleet Manager (Local macOS)

**Date:** 2026-04-10  
**Scope:** Local installation and first-run guide for internal macOS users who need to run Claw Fleet Manager without contributor-level setup knowledge  
**Format:** Markdown (`docs/guides/installation-guide.md`)  
**Audience:** Internal users on macOS who need to launch the dashboard locally and perform a basic sanity check

---

## Goals

Produce a step-by-step guide that lets a non-developer internal user:

- Get the repository onto a macOS machine
- Install the project dependencies needed to launch the dashboard locally
- Configure the server and web app with the minimum required settings
- Start the dashboard and sign in successfully
- Understand optional Docker readiness without forcing Docker setup on every reader

---

## Structure

### Hybrid Task Guide

A short overview and prerequisites section followed by standalone setup tasks. Each task section has:

- A brief statement of what the section is for
- Numbered steps with exact commands and file paths
- Short callouts for mistakes or optional branches

This should mirror the tone and readability of `docs/guides/admin-guide.md`, but it does not need screenshots in v1 because the work is mostly terminal and config-file based.

---

## Table of Contents

| # | Section | Description |
|---|---------|-------------|
| 0 | Overview | What this guide covers and who it is for |
| 1 | Prerequisites | External tools the user must already have available |
| 2 | Get the Code | Clone the repository and enter the project directory |
| 3 | Install Project Dependencies | Install npm dependencies and explain optional Docker readiness |
| 4 | Create the Server Config | Copy the example config and fill in the required values |
| 5 | Generate Local TLS Certificates | Create a self-signed cert for secure local use |
| 6 | Create the Web Env File | Copy the web env file and align auth credentials |
| 7 | Start the Dashboard | Launch the server and web app locally |
| 8 | First Login and Sanity Check | Open the app, accept the cert warning, and verify login |
| 9 | Stop the App | Shut down the local dev process |
| 10 | Troubleshooting | Common setup failures and how to recognize them |

---

## Section Specs

### Section 0: Overview

**Purpose:** Set expectations before the reader starts.

**Content:**
- Explain that this guide is for internal macOS users running Claw Fleet Manager locally
- State that it is not a contributor setup guide
- State that the guide covers first launch, not day-to-day admin workflows
- Link readers to `docs/guides/admin-guide.md` for dashboard operations after startup

---

### Section 1: Prerequisites

**Purpose:** Make the baseline assumptions explicit so the rest of the guide can stay focused.

**Content:**
- User must already have:
  - Homebrew
  - Git
  - Node.js
  - `openclaw`
- Add the `openclaw` install link instead of reproducing its installation instructions
- Mark Docker Desktop as optional, only needed for Docker-backed instances

**Gotchas:**
- The guide does not teach Homebrew, Git, Node.js, or `openclaw` installation
- If `openclaw` is not available in the shell `PATH`, profile-mode workflows will not work

---

### Section 2: Get the Code

**Purpose:** Put the project on the user’s machine in a known location.

**Steps:**
1. Clone the repository with `git clone`
2. Change into the repository directory with `cd`

**Verification:**
- Reader should be able to run `pwd` and `ls` and see the project files

---

### Section 3: Install Project Dependencies

**Purpose:** Install the JavaScript dependencies required to run the local dashboard.

**Steps:**
1. Run `npm install` from the repository root

**Optional Docker subsection:**
- Explain that Docker is not required just to launch the dashboard
- If the user wants Docker-backed instances, Docker Desktop must be installed and running
- Explain that the app expects an OpenClaw image tag, with the default local tag being `openclaw:local`
- Keep this subsection light: do not create a second full install track

**Gotchas:**
- If `npm` is missing, the user needs a working Node.js installation before continuing

---

### Section 4: Create the Server Config

**Purpose:** Create the minimum server configuration needed for a local run.

**Steps:**
1. Copy `packages/server/server.config.example.json` to `packages/server/server.config.json`
2. Set `fleetDir`
3. Set the seeded admin username and password in `auth`
4. Set the TLS certificate and key paths
5. Optionally add or enable the `profiles` block when the user wants native profile instances

**Field guidance:**
- `fleetDir`: path to the user’s OpenClaw fleet directory
- `auth.username` / `auth.password`: first local admin login
- `profiles`: optional native-profile settings; mention `openclawBinary`, ports, and directories in plain language
- `tls.cert` / `tls.key`: paths created in the TLS section

**Gotchas:**
- Avoid using `main` as a profile name because OpenClaw reserves it
- The guide should only explain the fields required for local startup, not every server option

---

### Section 5: Generate Local TLS Certificates

**Purpose:** Ensure the local environment supports secure browser features required by the app.

**Steps:**
1. Run the existing self-signed `openssl` command already used in `README.md`
2. Save the generated `cert.pem` and `key.pem` in a clear local location
3. Reference those paths in `packages/server/server.config.json`

**Explanation:**
- Use plain language: Control UI authentication needs a secure browser context, so local TLS is required

**Gotchas:**
- The browser will show a warning for the self-signed certificate the first time

---

### Section 6: Create the Web Env File

**Purpose:** Make the web app use the same credentials as the server.

**Steps:**
1. Copy `packages/web/.env.example` to `packages/web/.env.local`
2. Set `VITE_BASIC_AUTH_USER`
3. Set `VITE_BASIC_AUTH_PASSWORD`
4. Make sure those values match the server config auth block

**Gotchas:**
- If these values do not match the server-side credentials, login and API requests will fail in confusing ways

---

### Section 7: Start the Dashboard

**Purpose:** Launch the local server and the local dashboard together.

**Steps:**
1. Run `npm run dev`
2. Wait for the dev processes to start
3. Open the local URL in the browser

**Content:**
- Provide the expected dashboard URL and API URL from the current README
- Clarify that the API may be `https://localhost:3001`

**Verification:**
- The reader should see the login screen or the dashboard shell in the browser

---

### Section 8: First Login and Sanity Check

**Purpose:** Confirm the installation works end to end.

**Steps:**
1. Open the local dashboard URL
2. Accept the browser warning for the self-signed certificate if prompted
3. Sign in with the seeded admin credentials
4. Confirm the dashboard loads successfully
5. Optionally confirm that an instance can be viewed or created

**Gotchas:**
- If the login page loops or requests fail, the first things to check are the auth values and TLS setup

---

### Section 9: Stop the App

**Purpose:** Show the clean way to end the local session.

**Steps:**
1. Return to the terminal running `npm run dev`
2. Press `Ctrl+C`

---

### Section 10: Troubleshooting

**Purpose:** Help a non-technical user recognize the most common setup failures quickly.

**Entries to include:**
- `npm: command not found`
- Port already in use
- Browser security warning for self-signed cert
- Login/auth mismatch between `server.config.json` and `.env.local`
- `openclaw: command not found`
- Docker Desktop not running
- Docker image missing when attempting Docker-backed instances

Each troubleshooting item should be short and action-oriented: symptom first, likely cause second, fix third.

---

## Output File

| File | Purpose |
|------|---------|
| `docs/guides/installation-guide.md` | Primary guide for internal macOS users launching Claw Fleet Manager locally |

---

## What This Guide Does NOT Cover

- Homebrew installation instructions
- Git installation instructions
- Node.js installation instructions
- Full `openclaw` installation instructions
- Production/server deployment
- Contributor workflow, development architecture, or test workflows
- A full Docker-mode setup track
- Day-to-day dashboard administration after startup
