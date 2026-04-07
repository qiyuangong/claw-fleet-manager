# Claw Fleet Manager — 管理员指南（Profile 模式）

本指南涵盖 **Claw Fleet Manager** 在 Profile 模式下的日常管理工作流。
每个章节均可独立阅读，请直接跳至所需任务。

> **前提条件：** 您已以管理员账号登录，且服务器正在运行并可通过浏览器访问。

---

## 目录

- [0. 界面总览](#0-界面总览)
- [1. 创建新实例](#1-创建新实例)
- [2. 启动 / 停止 / 重启实例](#2-启动--停止--重启实例)
- [3. 用户管理](#3-用户管理)
- [4. 审批设备](#4-审批设备)
- [5. 飞书配对](#5-飞书配对)
- [6. 查看日志与监控运行状态](#6-查看日志与监控运行状态)
- [7. 安装或卸载插件](#7-安装或卸载插件)
- [8. 编辑实例配置](#8-编辑实例配置)

---

## 0. 界面总览

在浏览器中打开 Claw Fleet Manager 后，您将看到三个区域。

![仪表盘总览：左侧为侧边栏，中间为主面板，主面板顶部为标签栏](screenshots/00-dashboard.png)

**侧边栏（左列）**

| 元素 | 功能 |
|------|------|
| 实例列表 | 每个 profile 实例对应一个按钮，点击即可打开 |
| Manage Instances | 创建或删除实例 |
| Users | 创建和管理用户账号 |
| Fleet Config | 全局舰队设置 |

**主面板（中间）**

显示所选实例或管理面板的详细信息。

**标签栏（主面板顶部）**

选中实例后，标签栏提供以下选项：Overview · Logs · Config · Metrics · Control UI · Feishu · Plugins

> **注意：** 非管理员用户只能看到分配给自己的实例，无法看到 Users 或 Fleet Config 按钮。

---

## 1. 创建新实例

当您需要向舰队中添加新的 profile 网关时，使用此功能。

**步骤：**

1. 在侧边栏中，点击 **Manage Instances**（位于 Admin 区域下）。

   ![侧边栏中高亮显示 Manage Instances 按钮](screenshots/01-sidebar-manage-instances.png)

2. 点击 **Add Instance**。

   ![实例管理面板中的 Add Instance 按钮](screenshots/01-add-instance-button.png)

3. 在弹出的下拉菜单中，点击 **Create Profile Instance**。

4. 在打开的对话框中，输入实例名称。

   ![显示名称输入框的 Add Instance 对话框](screenshots/01-add-instance-dialog.png)

   > **命名规则：** 只能使用小写字母、数字和连字符（例如 `team-a`、`dev-1`）。名称 `main` 为保留字，请勿使用。

5. 如需指定特定端口，可填写 **Gateway Port**；留空则由系统自动分配。

6. 点击 **Create Profile Instance**。

7. 新实例将出现在侧边栏中，点击其名称即可打开。

> **创建后：** 实例初始为停止状态。请前往[第 2 节](#2-启动--停止--重启实例)启动它。

---

## 2. 启动 / 停止 / 重启实例

使用此功能控制实例的运行状态。

**步骤：**

1. 在侧边栏中点击实例名称。

2. 确认当前处于 **Overview** 标签页（默认已选中）。

   ![Overview 标签页，显示状态徽章及 Start / Stop / Restart 按钮](screenshots/02-overview-tab.png)

3. 点击所需操作：

   | 按钮 | 使用场景 | 可用状态 |
   |------|----------|----------|
   | **Start** | 启动已停止的实例 | 实例已停止 |
   | **Stop** | 关闭正在运行的实例 | 实例正在运行 |
   | **Restart** | 停止后立即重新启动 | 实例正在运行 |

4. 面板右上角的**状态徽章**将更新为 `running` 或 `stopped`。

> **提示：** 编辑实例配置后（见第 8 节），请使用 **Restart** 使更改生效。

---

## 3. 用户管理

使用此功能创建账号、控制用户可访问的实例，以及重置密码。

### 3a. 打开用户管理

点击侧边栏中的 **Users**（位于 Admin 区域下）。

![侧边栏中高亮显示 Users 按钮](screenshots/03-sidebar-users.png)

Users 面板将列出所有账号。

![用户管理面板，显示用户列表表格](screenshots/03-users-panel.png)

---

### 3b. 创建用户

1. 点击 **Add User**。

   ![显示用户名和密码输入框的 Add User 对话框](screenshots/03-add-user-dialog.png)

2. 输入**用户名**和**初始密码**。

3. 设置**角色**：
   - **Admin** — 可访问所有实例和管理面板
   - **User** — 只能访问分配给该用户的实例

4. 点击 **Create**。

---

### 3c. 为用户分配实例

拥有 **User** 角色的用户只能访问其 profile 分配中列出的实例。

1. 在表格中找到该用户，点击 Actions 列中的 **Instances** 按钮（仅对非管理员用户显示）。
2. 勾选或取消勾选该用户可访问的 profile 实例。
3. 点击 **Save**。

![用户管理面板](screenshots/03-users-panel.png)

---

### 3d. 重置密码

1. 在表格中找到该用户，点击 **Reset Password**。
2. 输入新密码并确认。
3. 点击 **Reset**。

> **注意：** 用户可在 My Account 面板中自行修改密码。

---

## 4. 审批设备

当用户的浏览器或客户端正在等待批准以连接到实例的 Control UI 时，使用此功能。

**步骤：**

1. 在侧边栏中点击实例名称。

2. 点击 **Control UI** 标签页。

3. 如有待审批设备，将显示一个黄色卡片，列出设备数量、每台设备的 IP 地址和请求 ID。

   ![Control UI 标签页，显示黄色待审批设备卡片及 Approve 和 Approve All 按钮](screenshots/04-controlui-pending.png)

4. 点击特定设备旁的 **Approve** 单独审批，或点击 **Approve All** 一次性审批所有设备。

5. 已审批的设备将立即从列表中消失。

> **没有待审批设备？** 如果卡片未出现，表示当前没有设备等待审批。

---

## 5. 飞书配对

使用此功能将实例连接到飞书（Lark）机器人频道，并审批用户的配对请求。

### 5a. 配置飞书凭据

每个实例只需配置一次（或在凭据更改时重新配置）。

1. 点击侧边栏中的实例名称 → **Feishu** 标签页。

   ![Feishu 标签页，显示 App ID、App Secret、Group Policy 和 Save Config 按钮](screenshots/05-feishu-config.png)

2. 输入飞书开发者控制台中的 **App ID** 和 **App Secret**（例如 `cli_xxx` 及对应的 secret）。

3. 设置 **Group Policy**（群组策略）：
   - **Open** — 机器人加入的任何群组均可使用
   - **Allowlist** — 仅限审批过的群组
   - **Disabled** — 禁止群组使用机器人

4. 勾选或取消勾选 **Require Mention** — 勾选后，用户必须 @提及机器人才能获得回复。

5. 点击 **Save Config**。

6. 前往 **Overview** 标签页，点击 **Restart** 使凭据生效。

---

### 5b. 审批飞书配对请求

当飞书用户向机器人发送配对命令后，其配对码将显示在此处。

1. 点击实例 → **Feishu** 标签页。

2. 在 **Pending Pairing Requests** 区域中找到该用户的配对码。

   ![Feishu 标签页，显示带有 Approve 按钮的待配对请求卡片](screenshots/05-feishu-pending.png)

3. 点击配对码旁的 **Approve**。

> **没有待处理请求？** 该区域将显示"No pending pairing requests."——用户可能尚未发送命令，或机器人未运行（请确认实例已启动且飞书凭据已保存）。

---

## 6. 查看日志与监控运行状态

### 6a. 实时日志流

使用此功能实时观察实例的运行情况，或排查问题。

1. 点击侧边栏中的实例名称 → **Logs** 标签页。

   ![Logs 标签页，在终端风格面板中显示流式日志输出](screenshots/06-logs-tab.png)

2. 日志自动流式输出，向上滚动可查看历史记录。

> **提示：** 如果实例已停止，日志面板将显示关闭前最后捕获的输出。

---

### 6b. CPU 与内存指标

使用此功能检查实例是否处于高负载或内存不足的状态。

1. 点击侧边栏中的实例名称 → **Metrics** 标签页。

   ![Metrics 标签页，显示 CPU 和内存使用量的时序图表](screenshots/06-metrics-tab.png)

2. 图表每隔几秒实时更新。

   | 图表 | 显示内容 |
   |------|----------|
   | CPU | 已分配 CPU 的使用百分比 |
   | Memory | 已使用内存与可用总内存 |

---

## 7. 安装或卸载插件

使用此功能为实例添加或移除扩展。

### 7a. 安装插件

1. 点击侧边栏中的实例名称 → **Plugins** 标签页。

   ![Plugins 标签页，显示已安装插件列表和 Install Plugin 按钮](screenshots/07-plugins-tab.png)

2. 点击 **Install Plugin**。

3. 输入插件标识符（例如 `@anthropic/plugin-name`）。

4. 点击 **Install**。安装完成后，插件将出现在已安装列表中。

---

### 7b. 卸载插件

1. 在已安装列表中找到该插件。

2. 点击旁边的 **Remove**（或垃圾桶图标）。

3. 在弹出的确认提示中确认移除。

> **注意：** 部分插件在安装或卸载后可能需要重启实例。请使用 **Overview** 标签页进行重启。

---

## 8. 编辑实例配置

使用此功能修改实例的设置——模型、API 密钥、提供商或其他任何 `openclaw.json` 字段。

**步骤：**

1. 点击侧边栏中的实例名称 → **Config** 标签页。

   ![Config 标签页，Monaco JSON 编辑器显示 openclaw.json 内容](screenshots/08-config-tab.png)

2. 编辑器显示该实例当前的 `openclaw.json`，修改需要更改的字段。

3. 点击 **Save**。

   > **JSON 错误：** 编辑器会以红色高亮标注语法错误，请在保存前修正——无效的 JSON 将被拒绝。

4. 前往 **Overview** 标签页，点击 **Restart**。配置更改仅在重启后生效。

   > **重要：** 请勿跳过重启步骤——实例在重启前将继续使用旧配置运行。
