# Admin Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a step-by-step administrator guide for Claw Fleet Manager (Profile mode) with annotated screenshots, plus a compact quick reference card.

**Architecture:** Two Markdown files in `docs/guides/`. The full guide (`admin-guide.md`) has 9 sections — a dashboard orientation plus 8 task workflows — each with numbered steps and screenshot references. A Playwright spec (`tests/e2e/screenshot-guide.spec.ts`) captures screenshots from the running app into `docs/guides/screenshots/`. The quick reference card (`admin-quick-reference.md`) summarises all tasks in a table with no screenshots.

**Tech Stack:** Markdown, Playwright (`@playwright/test`), running Claw Fleet Manager at `https://localhost:3001` (admin credentials required via env vars)

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `docs/guides/admin-guide.md` | Full administrator guide |
| Create | `docs/guides/admin-quick-reference.md` | One-page quick reference card |
| Create | `docs/guides/screenshots/` | Directory holding all guide screenshots |
| Create | `tests/e2e/screenshot-guide.spec.ts` | Playwright spec that captures screenshots |

---

## Task 1: Scaffold guide files and screenshots directory

**Files:**
- Create: `docs/guides/admin-guide.md`
- Create: `docs/guides/admin-quick-reference.md`
- Create: `docs/guides/screenshots/.gitkeep`

- [ ] **Step 1: Create the screenshots directory placeholder**

```bash
mkdir -p docs/guides/screenshots
touch docs/guides/screenshots/.gitkeep
```

Expected: directory exists, no error.

- [ ] **Step 2: Create the guide shell with front-matter**

Write `docs/guides/admin-guide.md`:

```markdown
# Claw Fleet Manager — Administrator Guide (Profile Mode)

This guide covers day-to-day admin workflows for **Claw Fleet Manager** running in Profile mode.
Each section is self-contained — jump directly to the task you need.

> **Prerequisites:** You are logged in as an admin user. The server is running and accessible in your browser.

---

## Table of Contents

- [0. Dashboard Orientation](#0-dashboard-orientation)
- [1. Create a New Instance](#1-create-a-new-instance)
- [2. Start / Stop / Restart an Instance](#2-start--stop--restart-an-instance)
- [3. Manage Users](#3-manage-users)
- [4. Approve a Device](#4-approve-a-device)
- [5. Feishu Pairing](#5-feishu-pairing)
- [6. View Logs and Monitor Health](#6-view-logs-and-monitor-health)
- [7. Install or Remove a Plugin](#7-install-or-remove-a-plugin)
- [8. Edit Instance Configuration](#8-edit-instance-configuration)

---
```

- [ ] **Step 3: Create the quick reference shell**

Write `docs/guides/admin-quick-reference.md`:

```markdown
# Claw Fleet Manager — Admin Quick Reference (Profile Mode)

| Task | Where to go | Key action |
|------|-------------|------------|
| Create instance | Sidebar → Manage Instances → Add Instance | Enter name → Create Profile Instance |
| Start instance | Sidebar → instance name → Overview tab | Click **Start** |
| Stop instance | Sidebar → instance name → Overview tab | Click **Stop** |
| Restart instance | Sidebar → instance name → Overview tab | Click **Restart** |
| Add user | Sidebar → Users → Add User | Enter username + password → Create |
| Assign instance to user | Sidebar → Users → edit user | Select profiles → Save |
| Reset user password | Sidebar → Users → Reset Password | Enter new password → Confirm |
| Approve device | Sidebar → instance → Control UI tab | Click **Approve** or **Approve All** |
| Configure Feishu | Sidebar → instance → Feishu tab | Enter App ID + Secret → Save Config |
| Approve Feishu pairing | Sidebar → instance → Feishu tab | Click **Approve** next to the code |
| View live logs | Sidebar → instance → Logs tab | Logs stream automatically |
| View CPU/memory | Sidebar → instance → Metrics tab | Charts update live |
| Install plugin | Sidebar → instance → Plugins tab | Click **Install Plugin** → enter ID |
| Remove plugin | Sidebar → instance → Plugins tab | Click **Remove** → confirm |
| Edit config | Sidebar → instance → Config tab | Edit JSON → Save → restart instance |
```

- [ ] **Step 4: Commit scaffold**

```bash
git add docs/guides/
git commit -m "docs: scaffold admin guide and quick reference"
```

---

## Task 2: Write Section 0 — Dashboard Orientation

**Files:**
- Modify: `docs/guides/admin-guide.md`

- [ ] **Step 1: Append Section 0 to the guide**

Append to `docs/guides/admin-guide.md`:

````markdown
## 0. Dashboard Orientation

When you open Claw Fleet Manager in your browser you see three areas.

![Dashboard overview showing sidebar on the left, main panel in the centre, and tab row at the top of the panel](screenshots/00-dashboard.png)

**Sidebar (left column)**

| Element | What it does |
|---------|-------------|
| Instance list | One button per profile instance — click to open it |
| Manage Instances | Create or delete instances |
| Users | Create and manage user accounts |
| Fleet Config | Global fleet settings |

**Main panel (centre)**

Shows details for the selected instance or admin panel.

**Tab row (top of main panel)**

When an instance is selected, the tab row gives you: Overview · Logs · Config · Metrics · Control UI · Feishu · Plugins

> **Note:** Non-admin users only see the instances assigned to them and do not see the Users or Fleet Config buttons.

---
````

- [ ] **Step 2: Commit**

```bash
git add docs/guides/admin-guide.md
git commit -m "docs: add Section 0 — Dashboard Orientation"
```

---

## Task 3: Write Section 1 — Create a New Instance

**Files:**
- Modify: `docs/guides/admin-guide.md`

- [ ] **Step 1: Append Section 1 to the guide**

Append to `docs/guides/admin-guide.md`:

````markdown
## 1. Create a New Instance

Use this when you need to add a new profile gateway to the fleet.

**Steps:**

1. In the sidebar, click **Manage Instances** (under the Admin section).

   ![Sidebar with Manage Instances button highlighted](screenshots/01-sidebar-manage-instances.png)

2. Click **Add Instance**.

   ![Instance management panel with Add Instance button](screenshots/01-add-instance-button.png)

3. From the dropdown that appears, click **Create Profile Instance**.

4. In the dialog that opens, enter a name for the instance.

   ![Add Instance dialog showing the name field](screenshots/01-add-instance-dialog.png)

   > **Name rules:** lowercase letters, numbers, and hyphens only (e.g. `team-a`, `dev-1`). The name `main` is reserved — do not use it.

5. Optionally enter a **Gateway Port** if you need a specific port. Leave it blank to let the system assign one automatically.

6. Click **Create Profile Instance**.

7. The new instance appears in the sidebar. Click its name to open it.

> **After creating:** The instance starts in a stopped state. Go to [Section 2](#2-start--stop--restart-an-instance) to start it.

---
````

- [ ] **Step 2: Commit**

```bash
git add docs/guides/admin-guide.md
git commit -m "docs: add Section 1 — Create a New Instance"
```

---

## Task 4: Write Section 2 — Start / Stop / Restart

**Files:**
- Modify: `docs/guides/admin-guide.md`

- [ ] **Step 1: Append Section 2 to the guide**

Append to `docs/guides/admin-guide.md`:

````markdown
## 2. Start / Stop / Restart an Instance

Use this to control whether an instance is running.

**Steps:**

1. Click the instance name in the sidebar.

2. Make sure you are on the **Overview** tab (it is selected by default).

   ![Overview tab showing status badge and Start / Stop / Restart buttons](screenshots/02-overview-tab.png)

3. Click the action you need:

   | Button | When to use | Enabled when |
   |--------|-------------|--------------|
   | **Start** | Launch a stopped instance | Instance is stopped |
   | **Stop** | Shut down a running instance | Instance is running |
   | **Restart** | Stop then immediately start | Instance is running |

4. The **status badge** in the top-right of the panel updates to `running` or `stopped`.

> **Tip:** After editing an instance's configuration (Section 8), use **Restart** for the changes to take effect.

---
````

- [ ] **Step 2: Commit**

```bash
git add docs/guides/admin-guide.md
git commit -m "docs: add Section 2 — Start / Stop / Restart"
```

---

## Task 5: Write Section 3 — Manage Users

**Files:**
- Modify: `docs/guides/admin-guide.md`

- [ ] **Step 1: Append Section 3 to the guide**

Append to `docs/guides/admin-guide.md`:

````markdown
## 3. Manage Users

Use this to create accounts, control which instances a user can access, and reset passwords.

### 3a. Open User Management

Click **Users** in the sidebar (under the Admin section).

![Sidebar with Users button highlighted](screenshots/03-sidebar-users.png)

The Users panel lists all accounts.

![User management panel showing a table of users](screenshots/03-users-panel.png)

---

### 3b. Create a User

1. Click **Add User**.

   ![Add User dialog with username and password fields](screenshots/03-add-user-dialog.png)

2. Enter a **username** and **initial password**.

3. Set the **role**:
   - **Admin** — full access to all instances and admin panels
   - **User** — access only to instances you assign to them

4. Click **Create**.

---

### 3c. Assign Instances to a User

Users with the **User** role can only access instances listed in their profile assignment.

1. Find the user in the table and click **Edit** (or the assignment control next to their name).
2. Select which profile instances this user may access.
3. Click **Save**.

![User edit panel with instance assignment selector](screenshots/03-assign-profiles.png)

---

### 3d. Reset a Password

1. Find the user in the table and click **Reset Password**.
2. Enter the new password and confirm it.
3. Click **Reset**.

> **Note:** Users can change their own password from the My Account panel.

---
````

- [ ] **Step 2: Commit**

```bash
git add docs/guides/admin-guide.md
git commit -m "docs: add Section 3 — Manage Users"
```

---

## Task 6: Write Section 4 — Approve a Device

**Files:**
- Modify: `docs/guides/admin-guide.md`

- [ ] **Step 1: Append Section 4 to the guide**

Append to `docs/guides/admin-guide.md`:

````markdown
## 4. Approve a Device

Use this when a user's browser or client is waiting for approval to connect to an instance's Control UI.

**Steps:**

1. Click the instance name in the sidebar.

2. Click the **Control UI** tab.

3. If there are pending devices, a yellow card shows the count and each device's IP address and request ID.

   ![Control UI tab showing a yellow pending devices card with Approve and Approve All buttons](screenshots/04-controlui-pending.png)

4. Click **Approve** next to a specific device to approve it individually, or click **Approve All** to approve all at once.

5. Approved devices disappear from the list immediately.

> **No pending devices?** If the card does not appear, there are no devices waiting for approval at this time.

---
````

- [ ] **Step 2: Commit**

```bash
git add docs/guides/admin-guide.md
git commit -m "docs: add Section 4 — Approve a Device"
```

---

## Task 7: Write Section 5 — Feishu Pairing

**Files:**
- Modify: `docs/guides/admin-guide.md`

- [ ] **Step 1: Append Section 5 to the guide**

Append to `docs/guides/admin-guide.md`:

````markdown
## 5. Feishu Pairing

Use this to connect an instance to a Feishu (Lark) bot channel and approve user pairing requests.

### 5a. Configure Feishu credentials

You only need to do this once per instance (or when credentials change).

1. Click the instance name in the sidebar → **Feishu** tab.

   ![Feishu tab showing App ID, App Secret, Group Policy, and Save Config button](screenshots/05-feishu-config.png)

2. Enter the **App ID** and **App Secret** from your Feishu developer console (e.g. `cli_xxx` and the corresponding secret).

3. Set **Group Policy**:
   - **Open** — any group the bot is added to can use it
   - **Allowlist** — only approved groups
   - **Disabled** — groups cannot use the bot

4. Check or uncheck **Require Mention** — when checked, users must @mention the bot to get a response.

5. Click **Save Config**.

6. Go to the **Overview** tab and click **Restart** for the credentials to take effect.

---

### 5b. Approve a Feishu pairing request

When a Feishu user sends the pairing command to the bot, their code appears here.

1. Click the instance → **Feishu** tab.

2. In the **Pending Pairing Requests** section, find the pairing code for the user.

   ![Feishu tab showing a pending pairing request card with an Approve button](screenshots/05-feishu-pending.png)

3. Click **Approve** next to the code.

> **No pending requests?** The section shows "No pending pairing requests." — the user either hasn't sent the command yet or the bot isn't running (check that the instance is started and Feishu credentials are saved).

---
````

- [ ] **Step 2: Commit**

```bash
git add docs/guides/admin-guide.md
git commit -m "docs: add Section 5 — Feishu Pairing"
```

---

## Task 8: Write Section 6 — Logs and Metrics

**Files:**
- Modify: `docs/guides/admin-guide.md`

- [ ] **Step 1: Append Section 6 to the guide**

Append to `docs/guides/admin-guide.md`:

````markdown
## 6. View Logs and Monitor Health

### 6a. Live log stream

Use this to watch what an instance is doing in real time or to investigate a problem.

1. Click the instance name in the sidebar → **Logs** tab.

   ![Logs tab showing streaming log output in a terminal-style panel](screenshots/06-logs-tab.png)

2. Logs stream in automatically. Scroll up to see older entries.

> **Tip:** If the instance is stopped, the log panel shows the last captured output before shutdown.

---

### 6b. CPU and memory metrics

Use this to check whether an instance is under load or running low on memory.

1. Click the instance name in the sidebar → **Metrics** tab.

   ![Metrics tab showing time-series charts for CPU and memory usage](screenshots/06-metrics-tab.png)

2. The charts update live every few seconds.

   | Chart | What it shows |
   |-------|--------------|
   | CPU | Percentage of allocated CPU used |
   | Memory | Used vs. total available memory |

---
````

- [ ] **Step 2: Commit**

```bash
git add docs/guides/admin-guide.md
git commit -m "docs: add Section 6 — Logs and Metrics"
```

---

## Task 9: Write Section 7 — Install or Remove a Plugin

**Files:**
- Modify: `docs/guides/admin-guide.md`

- [ ] **Step 1: Append Section 7 to the guide**

Append to `docs/guides/admin-guide.md`:

````markdown
## 7. Install or Remove a Plugin

Use this to add or remove extensions from an instance.

### 7a. Install a plugin

1. Click the instance name in the sidebar → **Plugins** tab.

   ![Plugins tab showing the installed plugins list and Install Plugin button](screenshots/07-plugins-tab.png)

2. Click **Install Plugin**.

3. Enter the plugin identifier (e.g. `@anthropic/plugin-name`).

4. Click **Install**. The plugin appears in the installed list once complete.

---

### 7b. Remove a plugin

1. Find the plugin in the installed list.

2. Click **Remove** (or the trash icon) next to it.

3. Confirm the removal in the prompt that appears.

> **Note:** Some plugins may require an instance restart after install or removal. Use the **Overview** tab to restart.

---
````

- [ ] **Step 2: Commit**

```bash
git add docs/guides/admin-guide.md
git commit -m "docs: add Section 7 — Install or Remove a Plugin"
```

---

## Task 10: Write Section 8 — Edit Instance Configuration

**Files:**
- Modify: `docs/guides/admin-guide.md`

- [ ] **Step 1: Append Section 8 to the guide**

Append to `docs/guides/admin-guide.md`:

````markdown
## 8. Edit Instance Configuration

Use this to change an instance's settings — model, API key, provider, or any other `openclaw.json` field.

**Steps:**

1. Click the instance name in the sidebar → **Config** tab.

   ![Config tab showing the Monaco JSON editor with openclaw.json content](screenshots/08-config-tab.png)

2. The editor shows the current `openclaw.json` for this instance. Edit the fields you need to change.

3. Click **Save**.

   > **JSON errors:** The editor highlights syntax errors in red. Fix them before saving — invalid JSON is rejected.

4. Go to the **Overview** tab and click **Restart**. Configuration changes take effect only after a restart.

   > **Important:** Do not skip the restart step — the instance continues running with the old settings until it is restarted.

---
````

- [ ] **Step 2: Commit**

```bash
git add docs/guides/admin-guide.md
git commit -m "docs: add Section 8 — Edit Instance Configuration"
```

---

## Task 11: Write the Playwright screenshot spec

**Files:**
- Create: `tests/e2e/screenshot-guide.spec.ts`

This spec navigates the app as an admin and captures a screenshot at each key UI state needed by the guide.

- [ ] **Step 1: Write the spec**

```typescript
// tests/e2e/screenshot-guide.spec.ts
import { expect, test, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const adminUsername = process.env.PLAYWRIGHT_ADMIN_USERNAME;
const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD;

const screenshotsDir = path.resolve('docs/guides/screenshots');

async function signInAsAdmin(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem('fleet_manager_auth_mode', 'manual');
    sessionStorage.setItem('fleet_manager_auth_disabled', '1');
  });
  await page.reload();
  await page.getByPlaceholder('Username').fill(adminUsername!);
  await page.getByPlaceholder('Password').fill(adminPassword!);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('button', { name: /admin/i })).toBeVisible({ timeout: 10_000 });
}

async function shot(page: Page, filename: string) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, filename), fullPage: false });
}

test.describe('Guide screenshots', () => {
  test.skip(!adminUsername || !adminPassword,
    'Set PLAYWRIGHT_ADMIN_USERNAME and PLAYWRIGHT_ADMIN_PASSWORD to capture screenshots');

  test('00 — dashboard overview', async ({ page }) => {
    await signInAsAdmin(page);
    // Select first instance if any exist so the tab row is visible
    const firstInstance = page.locator('.sidebar-nav .sidebar-nav-item').first();
    if (await firstInstance.isVisible()) await firstInstance.click();
    await shot(page, '00-dashboard.png');
  });

  test('01 — manage instances panel and add instance dialog', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('button', { name: 'Manage Instances' }).click();
    await shot(page, '01-sidebar-manage-instances.png');
    await page.getByRole('button', { name: 'Add Instance' }).click();
    await shot(page, '01-add-instance-button.png');
    await page.getByRole('button', { name: 'Create Profile Instance' }).click();
    await shot(page, '01-add-instance-dialog.png');
    await page.keyboard.press('Escape');
  });

  test('02 — overview tab', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-nav .sidebar-nav-item').first();
    await firstInstance.click();
    await page.getByRole('button', { name: 'Overview' }).click();
    await shot(page, '02-overview-tab.png');
  });

  test('03 — users panel and add user dialog', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('button', { name: 'Users' }).click();
    await shot(page, '03-sidebar-users.png');
    await shot(page, '03-users-panel.png');
    // Add User dialog
    await page.getByRole('button', { name: 'Add User' }).click();
    await shot(page, '03-add-user-dialog.png');
    await page.keyboard.press('Escape');
    // Assign profiles — click Edit on first non-admin user if present
    const editBtn = page.getByRole('button', { name: 'Edit' }).first();
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await shot(page, '03-assign-profiles.png');
      await page.keyboard.press('Escape');
    }
  });

  test('04 — control UI tab with pending devices', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-nav .sidebar-nav-item').first();
    await firstInstance.click();
    await page.getByRole('button', { name: 'Control UI' }).click();
    await shot(page, '04-controlui-pending.png');
  });

  test('05 — feishu tab', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-nav .sidebar-nav-item').first();
    await firstInstance.click();
    await page.getByRole('button', { name: 'Feishu' }).click();
    await shot(page, '05-feishu-config.png');
    await shot(page, '05-feishu-pending.png');
  });

  test('06 — logs and metrics tabs', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-nav .sidebar-nav-item').first();
    await firstInstance.click();
    await page.getByRole('button', { name: 'Logs' }).click();
    await page.waitForTimeout(1_000); // let logs stream in
    await shot(page, '06-logs-tab.png');
    await page.getByRole('button', { name: 'Metrics' }).click();
    await page.waitForTimeout(500);
    await shot(page, '06-metrics-tab.png');
  });

  test('07 — plugins tab', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-nav .sidebar-nav-item').first();
    await firstInstance.click();
    await page.getByRole('button', { name: 'Plugins' }).click();
    await shot(page, '07-plugins-tab.png');
  });

  test('08 — config tab', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-nav .sidebar-nav-item').first();
    await firstInstance.click();
    await page.getByRole('button', { name: 'Config' }).click();
    await page.waitForTimeout(500); // let Monaco load
    await shot(page, '08-config-tab.png');
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/screenshot-guide.spec.ts
git commit -m "test: add Playwright screenshot spec for admin guide"
```

---

## Task 12: Capture screenshots

**Files:**
- Populate: `docs/guides/screenshots/*.png`

Screenshots require a running, configured instance of the app. Run this against your deployed server or dev environment.

- [ ] **Step 1: Set credentials and run the screenshot spec**

```bash
PLAYWRIGHT_ADMIN_USERNAME=<your-admin-user> \
PLAYWRIGHT_ADMIN_PASSWORD=<your-admin-password> \
PLAYWRIGHT_BASE_URL=https://localhost:3001 \
npx playwright test tests/e2e/screenshot-guide.spec.ts --reporter=list
```

Expected output: each test passes and prints `PASSED`. Screenshot files appear in `docs/guides/screenshots/`.

- [ ] **Step 2: Verify screenshots exist**

```bash
ls docs/guides/screenshots/
```

Expected output lists all 16 files:
```
00-dashboard.png
01-add-instance-button.png
01-add-instance-dialog.png
01-sidebar-manage-instances.png
02-overview-tab.png
03-add-user-dialog.png
03-assign-profiles.png
03-sidebar-users.png
03-users-panel.png
04-controlui-pending.png
05-feishu-config.png
05-feishu-pending.png
06-logs-tab.png
06-metrics-tab.png
07-plugins-tab.png
08-config-tab.png
```

- [ ] **Step 3: Commit screenshots**

```bash
git add docs/guides/screenshots/
git commit -m "docs: add admin guide screenshots"
```

---

## Task 13: Final review and commit

- [ ] **Step 1: Read through the complete guide**

```bash
cat docs/guides/admin-guide.md
```

Check: every section has a matching screenshot reference, all image filenames in the guide match files in `docs/guides/screenshots/`, numbered steps are clear and correct.

- [ ] **Step 2: Read through the quick reference card**

```bash
cat docs/guides/admin-quick-reference.md
```

Check: every task in the full guide has a matching row in the table, directions are consistent with the full guide.

- [ ] **Step 3: Final commit**

```bash
git add docs/guides/
git commit -m "docs: complete admin guide (profile mode) with quick reference"
```
