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
