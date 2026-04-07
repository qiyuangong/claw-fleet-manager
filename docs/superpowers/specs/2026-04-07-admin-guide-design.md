# Admin Guide Design — Claw Fleet Manager (Profile Mode)

**Date:** 2026-04-07  
**Scope:** Non-technical administrator guide covering day-to-day admin workflows in Profile mode  
**Format:** Markdown (`docs/guides/admin-guide.md`), screenshot placeholders with alt-text annotations  
**Audience:** Administrators who manage the fleet but are not software developers

---

## Goals

Produce a step-by-step guide with screenshots that lets a non-technical administrator:

- Understand the dashboard layout at a glance
- Perform all common admin workflows without needing command-line access
- Use each section independently as a quick reference (no required reading order)

---

## Structure

### Hybrid Format

A short orientation section followed by standalone task sections. Each task section has:

- A brief "when to use this" sentence
- Numbered steps with screenshot placeholder at each key click
- Any warnings or gotchas called out in a callout block

---

## Table of Contents

| # | Section | Description |
|---|---------|-------------|
| 0 | Dashboard Orientation | What you see when you log in: sidebar, panels, tabs |
| 1 | Create a New Instance | Add a profile instance from the sidebar |
| 2 | Start / Stop / Restart an Instance | Control instance lifecycle from the Overview tab |
| 3 | Manage Users | Create users, assign them to instances, reset passwords |
| 4 | Approve a Device | Review and approve pending device requests (Control UI tab) |
| 5 | Feishu Pairing | Configure and approve Feishu bot channel pairing (Feishu tab) |
| 6 | View Logs & Monitor Health | Live log streaming and CPU/memory metrics |
| 7 | Install / Remove a Plugin | Add or remove extensions from an instance |
| 8 | Edit Instance Configuration | Modify openclaw.json settings from the Config tab |

---

## Section Specs

### Section 0: Dashboard Orientation

**Purpose:** Orient a first-time admin to the three-panel layout before jumping into tasks.

**Content:**
- Annotated screenshot of the full dashboard
- Labels pointing to: Sidebar (instance list + admin nav), Main panel (instance workspace), Tab row (Overview / Logs / Config / Metrics / Control UI / Feishu / Plugins)
- Note that only instances assigned to the logged-in user appear in the sidebar (for non-admin users)

---

### Section 1: Create a New Instance

**Trigger:** Admin wants to add a new profile gateway to the fleet.

**Steps:**
1. Click **+** (add instance) button in the sidebar
2. Fill in the instance name (lowercase letters, numbers, hyphens only — no spaces)
3. Confirm — instance appears in the sidebar
4. Click the new instance to open its Overview tab

**Screenshot slots:** sidebar with + button highlighted → Add Instance dialog → newly created instance in sidebar

**Gotchas:**
- Do not use `main` as a profile name — it conflicts with OpenClaw's default standalone profile
- Name must be lowercase alphanumeric + hyphens only

---

### Section 2: Start / Stop / Restart an Instance

**Trigger:** Admin needs to control an instance's lifecycle.

**Steps:**
1. Click the instance name in the sidebar
2. Confirm you're on the **Overview** tab
3. Click **Start**, **Stop**, or **Restart** as needed
4. The status badge updates (running / stopped)

**Screenshot slots:** Overview tab with status badge and action buttons highlighted

**Gotchas:**
- Stop is disabled when instance is already stopped; Start is disabled when running
- Restart is only available when the instance is running

---

### Section 3: Manage Users

**Trigger:** Admin needs to create a new user account, assign them to specific instances, or reset a password.

**Sub-tasks:**

#### 3a. Open User Management
- Click **Users** in the sidebar admin navigation

#### 3b. Create a User
1. Click **Add User**
2. Enter username and initial password
3. Set role: **Admin** (full access) or **User** (assigned instances only)
4. Click **Create**

#### 3c. Assign Instances to a User
1. Find the user in the user list
2. Click **Edit** or the assignment control
3. Select which profile instances this user can access
4. Save

#### 3d. Reset a Password
1. Find the user → click **Reset Password**
2. Enter new password → confirm

**Screenshot slots:** sidebar Users link → user list → Add User dialog → instance assignment picker

---

### Section 4: Approve a Device

**Trigger:** A user has connected a new device (browser/client) to an instance and it is pending approval.

**Steps:**
1. Click the instance in the sidebar
2. Click the **Control UI** tab
3. If there are pending devices, a yellow warning card shows the count and device IDs
4. Click **Approve** next to a specific device, or **Approve All** to approve all at once

**Screenshot slots:** Control UI tab with yellow pending devices card → Approve All button highlighted

---

### Section 5: Feishu Pairing

**Trigger:** A Feishu bot user needs to be paired to an instance's Feishu channel.

**Sub-tasks:**

#### 5a. Configure Feishu credentials
1. Click the instance in the sidebar → **Feishu** tab
2. Enter **App ID** and **App Secret** from your Feishu developer console
3. Set **Group Policy** (open / allowlist / disabled) and **Require Mention** as needed
4. Click **Save Config**
5. Restart the instance for the credentials to take effect

#### 5b. Approve a pairing request
1. A Feishu user initiates pairing from the bot — a pairing code is generated
2. In the **Feishu** tab, pending pairing codes appear in the **Pending Pairing Requests** section
3. Click **Approve** next to the relevant code

**Screenshot slots:** Feishu tab with App ID/Secret fields → Save Config button → pending pairing request card → Approve button

---

### Section 6: View Logs & Monitor Health

**Trigger:** Admin wants to check what an instance is doing or investigate a problem.

**Sub-tasks:**

#### 5a. Live Logs
1. Click instance → **Logs** tab
2. Logs stream in real-time; scroll up to see history

#### 5b. CPU & Memory Metrics
1. Click instance → **Metrics** tab
2. View time-series charts for CPU and memory usage

**Screenshot slots:** Logs tab with streaming output → Metrics tab with charts

---

### Section 7: Install / Remove a Plugin

**Trigger:** Admin wants to add or remove an extension from an instance.

**Steps to install:**
1. Click instance → **Plugins** tab
2. Click **Install Plugin**
3. Enter the plugin identifier
4. Confirm — plugin appears in the installed list

**Steps to remove:**
1. Find the plugin in the installed list
2. Click **Remove** / trash icon
3. Confirm the removal prompt

**Screenshot slots:** Plugins tab → install dialog → installed plugin with remove button

---

### Section 8: Edit Instance Configuration

**Trigger:** Admin needs to change an instance's `openclaw.json` settings (model, API key, etc.).

**Steps:**
1. Click instance → **Config** tab
2. The editor shows the current `openclaw.json`
3. Make changes directly in the editor (Monaco editor with syntax highlighting)
4. Click **Save**
5. Restart the instance for changes to take effect (go to Overview tab → Restart)

**Screenshot slots:** Config tab with editor → Save button → restart reminder callout

**Gotchas:**
- Invalid JSON will be rejected — the editor highlights errors
- Changes to model/API key settings require an instance restart to apply

---

## Output File

`docs/guides/admin-guide.md`

Screenshot images go in `docs/guides/screenshots/` with filenames matching their section (e.g., `01-sidebar-add-instance.png`, `03a-user-management.png`).

---

## What This Guide Does NOT Cover

- Initial server installation and `server.config.json` setup (separate setup guide)
- Docker mode workflows
- Tailscale / HTTPS configuration
- Command-line operations
