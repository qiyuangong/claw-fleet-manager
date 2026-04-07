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
