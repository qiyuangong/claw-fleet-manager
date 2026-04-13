# Claw Fleet Manager — Administrator Guide

This guide covers day-to-day admin workflows for **Claw Fleet Manager**.
Each section is self-contained — jump directly to the task you need.

> **Prerequisites:** You are logged in as an admin user. The server is running and accessible in your browser.

---

## Table of Contents

- [0. Dashboard Orientation](#0-dashboard-orientation)
- [1. Create a New Instance](#1-create-a-new-instance)
- [2. Start / Stop / Restart an Instance](#2-start--stop--restart-an-instance)
- [3. Rename an Instance](#3-rename-an-instance)
- [4. Manage Users](#4-manage-users)
- [5. Approve a Device](#5-approve-a-device)
- [6. Feishu Pairing](#6-feishu-pairing)
- [7. View Logs and Monitor Health](#7-view-logs-and-monitor-health)
- [8. View Instance Activity](#8-view-instance-activity)
- [9. Install or Remove a Plugin](#9-install-or-remove-a-plugin)
- [10. Edit Instance Configuration](#10-edit-instance-configuration)
- [11. Monitor Active Sessions Fleet-Wide](#11-monitor-active-sessions-fleet-wide)
- [12. Review Session History](#12-review-session-history)
- [13. View the Admin Dashboard](#13-view-the-admin-dashboard)

---

## 0. Dashboard Orientation

When you open Claw Fleet Manager in your browser you see three areas.

![Dashboard overview showing sidebar on the left, main panel in the centre, and tab row at the top of the panel](screenshots/00-dashboard.png)

**Sidebar (left column)**

| Element | What it does |
|---------|-------------|
| Instance list | One button per instance — click to open it (non-admin users only) |
| Dashboard | Fleet-wide session overview: status breakdowns, activity board, filters (admin only) |
| Manage Instances | Create, rename, or delete instances (admin only) |
| Running | Live monitor of all currently active sessions across the fleet (admin only) |
| Activity | Historical session table with filtering, sorting, and search (admin only) |
| Users | Create and manage user accounts (admin only) |
| Fleet Config | Global fleet settings (admin only) |

**Main panel (centre)**

Shows details for the selected instance or admin panel.

**Tab row (top of main panel)**

When an instance is selected, the tab row gives you: Overview · Activity · Logs · Config · Metrics · Control UI · Feishu · Plugins

> **Note:** Non-admin users only see the instances assigned to them and do not see the admin navigation items.

---

## 1. Create a New Instance

Use this when you need to add a new profile gateway to the fleet.

**Steps:**

1. In the sidebar, click **Manage Instances** (under the Admin section).

   ![Sidebar with Manage Instances button highlighted](screenshots/01-sidebar-manage-instances.png)

2. Click **+ Add Instance**.

   ![Instance management panel with Add Instance button](screenshots/01-add-instance-button.png)

3. From the dropdown that appears, click **Create Profile**.

4. In the dialog that opens, enter a name for the instance.

   ![Add Instance dialog showing the name field](screenshots/01-add-instance-dialog.png)

   > **Name rules:** lowercase letters, numbers, and hyphens only (e.g. `team-a`, `dev-1`). The name `main` is reserved — do not use it.

5. Optionally enter a **Gateway Port** if you need a specific port. Leave it blank to let the system assign one automatically.

6. Click **Create Profile**.

7. The new instance appears in the sidebar. Click its name to open it.

> **After creating:** The instance starts in a stopped state. Go to [Section 2](#2-start--stop--restart-an-instance) to start it.

---

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

> **Tip:** After editing an instance's configuration (Section 10), use **Restart** for the changes to take effect.

---

## 3. Rename an Instance

Use this to give an instance a new name. Renaming is only available for **stopped** instances.

**Steps:**

1. In the sidebar, click **Manage Instances** (under the Admin section).

2. Locate the instance you want to rename. If it is running, stop it first using the **Stop** button in the same row.

3. Click **Rename** in the instance's action row.

   > **Rename is disabled** while the instance is running. The button tooltip explains this.

4. In the dialog that opens, enter the new name.

   > **Name rules:** lowercase letters, numbers, and hyphens only (e.g. `team-a`, `worker-2`). Applies to both profile and Docker instances.

5. Click **Rename**. The instance reappears under the new name.

> **After renaming:** User profile assignments that referenced the old name are updated automatically. Restart the instance after renaming to resume normal operation.

---

## 4. Manage Users

Use this to create accounts, control which instances a user can access, and reset passwords.

### 4a. Open User Management

Click **Users** in the sidebar (under the Admin section).

![Sidebar with Users button highlighted](screenshots/03-sidebar-users.png)

The Users panel lists all accounts.

![User management panel showing a table of users](screenshots/03-users-panel.png)

---

### 4b. Create a User

1. In the **Add User** section, enter the new account details.

   ![Add User section with username and password fields](screenshots/03-add-user-dialog.png)

2. Enter a **username** and **initial password**.

3. Set the **role**:
   - **Admin** — full access to all instances and admin panels
   - **User** — access only to instances you assign to them

4. Click **Add**.

---

### 4c. Assign Instances to a User

Users with the **User** role can only access instances listed in their profile assignment.

1. Find the user in the table and click **Instances** (shown in the Actions column for non-admin users).
2. Check or uncheck the profile instances this user may access.
3. Click **Save**.

> **Important:** Each profile instance can belong to only one user at a time. Assigning an instance here removes it from the previous user's access list.

![User management panel](screenshots/03-users-panel.png)

---

### 4d. Reset a Password

1. Find the user in the table and click **Reset Password**.
2. Enter the new password and confirm it.
3. Click **Save**.

> **Note:** Users can change their own password from the My Account panel.

---

## 5. Approve a Device

Use this when a user's browser or client is waiting for approval to connect to an instance's Control UI.

**Steps:**

1. Click the instance name in the sidebar.

2. Click the **Control UI** tab.

3. If there are pending devices, a yellow card shows the count and each device's IP address and request ID.

   ![Control UI tab showing a yellow pending devices card with Approve and Approve All buttons](screenshots/04-controlui-pending.png)

4. Click **Approve** next to a specific device to approve it individually, or click **Approve All** to approve all at once.

5. Approved devices disappear from the list immediately.

> **No pending devices?** The page shows `No device approvals are waiting right now.`

---

## 6. Feishu Pairing

Use this to connect an instance to a Feishu (Lark) bot channel and approve user pairing requests.

### 6a. Configure Feishu credentials

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

### 6b. Approve a Feishu pairing request

When a Feishu user sends the pairing command to the bot, their code appears here.

1. Click the instance → **Feishu** tab.

2. In the **Pending Pairing Requests** section, find the pairing code for the user.

   ![Feishu tab showing a pending pairing request card with an Approve button](screenshots/05-feishu-pending.png)

3. Click **Approve** next to the code.

> **No pending requests?** The section may show `No pending pairing requests.` or the latest pairing command output. If nothing is waiting, check that the instance is started and Feishu credentials are saved.

---

## 7. View Logs and Monitor Health

### 7a. Live log stream

Use this to watch what an instance is doing in real time or to investigate a problem.

1. Click the instance name in the sidebar → **Logs** tab.

   ![Logs tab showing streaming log output in a terminal-style panel](screenshots/06-logs-tab.png)

2. Logs stream in automatically. Scroll up to see older entries already shown in the panel.

> **Tip:** If no new lines appear, confirm the instance is running and generating output.

---

### 7b. CPU and memory metrics

Use this to check whether an instance is under load or running low on memory.

1. Click the instance name in the sidebar → **Metrics** tab.

   ![Metrics tab showing time-series charts for CPU and memory usage](screenshots/06-metrics-tab.png)

2. The charts update live every few seconds.

   | Chart | What it shows |
   |-------|--------------|
   | CPU | Percentage of allocated CPU used |
   | Memory | Used vs. total available memory |

---

## 8. View Instance Activity

Use this to review the session history for a specific instance — what sessions have run, their status, token usage, and cost.

**Steps:**

1. Open an instance panel — in the sidebar click **Manage Instances**, then click **Open Instance** in the row for the instance you want. Once the instance panel is open, click the **Activity** tab.

2. The tab shows a list of sessions with:
   - session title and key
   - status (`running`, `done`, `failed`, `killed`, `timeout`)
   - model used
   - token usage and estimated cost
   - relative timestamp

3. Use the status and time filters to narrow the list. Use the search box to find sessions by title, key, model, or last message preview.

4. Switch between **Board** and **Table** view using the view toggle in the toolbar.

> **Tip:** The board view groups sessions into status columns (running, done, failed, killed/timeout). The table view is better for sorting by cost or token count.

---

## 9. Install or Remove a Plugin

Use this to add or remove extensions from an instance.

### 9a. Install a plugin

1. Click the instance name in the sidebar → **Plugins** tab.

   ![Plugins tab showing the installed plugins list and Install Plugin button](screenshots/07-plugins-tab.png)

2. In the **Install Plugin** section, enter the plugin package name or local path.

3. For example, enter a plugin identifier such as `@anthropic/plugin-name`.

4. Click **Install**. The plugin appears in the installed list once complete.

---

### 9b. Remove a plugin

1. Find the plugin in the installed list.

2. Click **Remove** (or the trash icon) next to it.

3. Confirm the removal in the prompt that appears.

> **Note:** Some plugins may require an instance restart after install or removal. Use the **Overview** tab to restart.

---

## 10. Edit Instance Configuration

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

## 11. Monitor Active Sessions Fleet-Wide

Use this to watch what is happening across all instances in real time.

**Steps:**

1. In the sidebar, click **Running** (under the Admin section).

2. Click **Start** to begin live polling. The panel refreshes every 300 ms.

3. The panel shows a card per active session, including:
   - instance ID
   - session title and key
   - model in use
   - token count and cost so far
   - a scrolling preview of the most recent messages

4. Use the search box to filter by instance ID, session key, model, or message text.

5. Click an instance ID link to jump directly to that instance's panel.

6. Click **Stop** to pause live polling.

> **Note:** The monitoring state is persisted in browser local storage across page reloads.

---

## 12. Review Session History

Use this to look up completed, failed, or killed sessions across the entire fleet.

**Steps:**

1. In the sidebar, click **Activity** (under the Admin section).

2. The panel shows a filterable, sortable table of sessions from all instances.

3. Filter by status using the status tabs: **All · Active · Done · Error**.

4. Filter by time window: **Today · Last 24 h · Last 7 d · All**.

5. Click a column header to sort by that column.

6. Use the search box to find sessions by title, key, model, or last message preview.

7. Switch between **Board** view (kanban-style columns) and **Table** view using the view toggle.

8. Click an instance ID to navigate to that instance's panel.

---

## 13. View the Admin Dashboard

Use this for a fleet-wide overview of session health and activity trends.

**Steps:**

1. In the sidebar, click **Dashboard** (under the Admin section).

2. The dashboard shows:
   - a status summary card with counts for running, done, failed, and killed/timeout sessions
   - an activity board with the filtered session list
   - clickable status buckets in the summary card — clicking a bucket focuses the board on that status

3. Adjust the **status filter** (All · Active · Done · Error) and **time window** (Today · Last 24 h · Last 7 d · All) to narrow the view.

4. Use the search box to find sessions across all instances.

5. Click **Reset filters** to return to the default view.

6. Click **Refresh** to fetch the latest data manually.
