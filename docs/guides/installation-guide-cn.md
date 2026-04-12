# Claw Fleet Manager — 本地安装指南（macOS）

本指南帮助内部 macOS 用户首次在本地运行 **Claw Fleet Manager**。
内容聚焦于初始配置与首次启动，不涉及贡献者工作流或生产环境部署。

> **完成安装后：** 日常仪表盘操作请参阅[管理员指南](admin-guide-cn.md)。

---

## 目录

- [0. 概览](#0-概览)
- [1. 前置条件](#1-前置条件)
- [2. 获取代码](#2-获取代码)
- [3. 安装项目依赖](#3-安装项目依赖)
- [4. 创建服务器配置文件](#4-创建服务器配置文件)
- [5. 生成本地 TLS 证书](#5-生成本地-tls-证书)
- [6. 创建 Web 环境变量文件](#6-创建-web-环境变量文件)
- [7. 启动仪表盘](#7-启动仪表盘)
- [8. 首次登录与验证](#8-首次登录与验证)
- [9. 停止应用](#9-停止应用)
- [10. 故障排查](#10-故障排查)

---

## 0. 概览

当您需要在 macOS 本地运行 Claw Fleet Manager，且无需了解贡献者配置细节时，请使用本指南。

本指南涵盖：

- 克隆代码仓库
- 安装项目依赖
- 创建本地配置文件
- 启动仪表盘
- 首次登录

本指南**不**涵盖：

- Homebrew 安装
- Git 安装
- Node.js 安装
- `openclaw` 完整安装说明
- 生产环境部署

---

## 1. 前置条件

开始之前，请确保您的 Mac 上已安装以下工具：

- Homebrew
- Git
- Node.js 20+
- `openclaw`

`openclaw` 的安装请参阅官方文档：

- [安装 OpenClaw](https://docs.openclaw.ai/install)

**如果您之后计划使用 Docker，还需要：**

- Docker Desktop

> **重要：** 本指南假设 `openclaw` 已在您的 shell `PATH` 中可用。如果 `openclaw --version` 命令失败，请先解决该问题再继续。

---

## 2. 获取代码

本节将代码克隆到您机器上的指定位置。

**操作步骤：**

1. 克隆代码仓库：

   ```bash
   git clone https://github.com/qiyuangong/claw-fleet-manager.git
   ```

2. 进入项目目录：

   ```bash
   cd claw-fleet-manager
   ```

3. 确认您已在仓库根目录下：

   ```bash
   pwd
   ls
   ```

---

## 3. 安装项目依赖

本节安装在本地运行仪表盘所需的 JavaScript 依赖。

**操作步骤：**

1. 运行：

   ```bash
   npm install
   ```

2. 等待安装完成且无报错。

**可选：Docker 实例支持**

仅启动仪表盘本身**不需要** Docker。

如果您之后计划使用 Docker 实例：

- 确保 Docker Desktop 已安装并运行
- 确保本地已有可用的 OpenClaw 镜像
- Fleet Manager 默认使用的本地镜像标签为 `openclaw:local`

---

## 4. 创建服务器配置文件

本节创建最小化的本地服务器配置。

**操作步骤：**

1. 复制示例配置文件：

   ```bash
   cp packages/server/server.config.example.json packages/server/server.config.json
   ```

2. 在编辑器中打开 `packages/server/server.config.json`。

3. 在首次启动前，先创建 `fleetDir` 所指向的目录。对于上面的示例路径，运行：

   ```bash
   mkdir -p /Users/your-name/openclaw-fleet
   ```

4. 设置必填字段：

   - `fleetDir`：存放 OpenClaw 舰队数据的目录，例如 `/Users/your-name/openclaw-fleet`
   - `auth.username` 和 `auth.password`：用于登录的本地管理员账号
   - 仅在本地调试场景将 `seedTestUser` 设为 `true`，以预置普通用户账号 `testuser`（密码 `testuser`）
   - `tls.cert` 和 `tls.key`：下一节将创建的证书路径

   > 生产环境加固建议：
   > 1. 设置强密码并更新 `auth.password`
   > 2. 如果已启用 `seedTestUser`，管理员登录后删除 `testuser`：
   >    ```bash
   >    curl -k -u admin:新管理员密码 -X DELETE https://localhost:3001/api/users/testuser
   >    ```
   > 3. 或者直接从 `${fleetDir}/users.json` 删除 `testuser` 记录并重启服务

5. 如果本次本地配置不打算使用 Tailscale，请从示例配置中删除 `tailscale` 块。

6. Profile 实例已内置默认值，可直接使用。如需自定义，请将示例配置中的 `_profiles` 块复制并重命名为 `profiles`，再根据您的机器修改对应值。`openclawBinary` 是服务器运行 OpenClaw 的命令，端口设置控制 profile 实例使用的本地端口，`stateBaseDir` 和 `configBaseDir` 是 profile 实例存储本地状态和配置文件的目录。

> **注意：** 请勿使用 `main` 作为 profile 名称。OpenClaw 将该名称保留给独立默认 profile。

---

## 5. 生成本地 TLS 证书

本节创建本地自签名证书。

Control UI 鉴权流程需要安全的浏览器上下文，因此必须使用 TLS。

**操作步骤：**

1. 运行：

   ```bash
   openssl req -x509 -newkey rsa:4096 -nodes -days 365 \
     -keyout key.pem -out cert.pem \
     -subj "/CN=localhost" \
     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
   ```

2. 将 `cert.pem` 和 `key.pem` 保存到便于查找的位置。

3. 更新 `packages/server/server.config.json`，确保：

   - `tls.cert` 指向 `cert.pem`
   - `tls.key` 指向 `key.pem`

> **注意：** 如果您直接访问 `https://localhost:3001` 或以其他方式遇到自签名 API 证书，浏览器可能会显示安全警告。在本地开发中接受该警告并继续即可。

---

## 6. 创建 Web 环境变量文件

本节使 Web 应用发送与服务器匹配的 Basic Auth 凭据。

**操作步骤：**

1. 复制示例环境变量文件：

   ```bash
   cp packages/web/.env.example packages/web/.env.local
   ```

2. 打开 `packages/web/.env.local`。

3. 设置：

   - `VITE_BASIC_AUTH_USER`
   - `VITE_BASIC_AUTH_PASSWORD`

4. 确保这些值与 `packages/server/server.config.json` 中的 `auth.username` 和 `auth.password` 完全一致。

---

## 7. 启动仪表盘

本节同时启动本地服务器和 Web 应用。

**操作步骤：**

1. 启动应用：

   ```bash
   npm run dev
   ```

2. 等待两个开发进程均启动完成。

3. 在浏览器中打开仪表盘：

   - 仪表盘：`http://localhost:5173`
   - API 服务器：`https://localhost:3001`

---

## 8. 首次登录与验证

本节确认端到端配置正常。

**操作步骤：**

1. 在浏览器中打开 `http://localhost:5173`。
2. 如果 `.env.local` 配置正确，仪表盘可能会自动登录；如果弹出登录提示，请使用当前本地配置的用户名和密码。
3. 如果浏览器对自签名 API 证书发出警告，接受后继续即可。
4. 确认仪表盘成功加载。

**可选验证：**

- 打开管理仪表盘，确认主界面正常显示
- 如果您已配置舰队数据，确认现有实例正常出现

---

## 9. 停止应用

本节说明如何结束本地会话。

**操作步骤：**

1. 切换到运行 `npm run dev` 的终端窗口。
2. 按 `Ctrl+C`。

---

## 10. 故障排查

### `npm: command not found`

可能原因：Node.js 未正确安装。

解决方法：安装或修复 Node.js，然后确认 `node --version` 和 `npm --version` 均可正常运行。

### 端口已被占用

可能原因：本地已有其他进程占用了 `5173` 或 `3001` 端口。

解决方法：停止冲突进程，再重新运行 `npm run dev`。

### 浏览器显示证书警告

可能原因：您使用的是本地自签名证书。

解决方法：在本地开发中接受该警告并继续。

### 登录失败或 API 请求不工作

可能原因：当前登录凭据与本地配置不匹配，或该舰队已在使用 `fleetDir/users.json`。

解决方法：首次运行时，确保凭据与 `packages/server/server.config.json` 一致；否则请验证现有的 `fleetDir/users.json`，然后重新运行 `npm run dev`。

### `openclaw: command not found`

可能原因：OpenClaw 未安装，或不在您的 shell `PATH` 中。

解决方法：按官方文档安装 OpenClaw，然后确认 `openclaw --version` 正常运行。

### Docker 实例无法工作

可能原因：Docker Desktop 未运行，或配置的镜像标签在本地不存在。

解决方法：启动 Docker Desktop，并确认期望的 OpenClaw 镜像标签在本地存在。
