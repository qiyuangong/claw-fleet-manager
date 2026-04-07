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
