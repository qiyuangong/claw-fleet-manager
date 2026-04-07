# Claw Fleet Manager

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge" alt="Apache 2.0 License"/></a>
  <img src="https://img.shields.io/badge/Node.js-20+-green?style=for-the-badge" alt="Node.js 20+"/>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19"/>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="docs/arch/README_CN.md">架构文档</a> ·
  <a href="docs/guides/admin-guide-cn.md">管理员指南</a> ·
  <a href="docs/guides/admin-quick-reference-cn.md">快速参考</a>
</p>

在浏览器中管理 `openclaw` 集群 —— 无需命令行，即可启停实例、编辑配置、查看监控。

<p align="center">
  <img src="docs/guides/screenshots/00-dashboard.png" alt="Claw Fleet Manager 管理面板" width="800"/>
</p>

服务端运行单一**混合后端**，同时支持两种实例类型：

- **Profile 实例** — 原生 `openclaw --profile` 网关进程，支持自动重启和完整生命周期管理
- **Docker 实例** — 直接管理 `openclaw-N` 容器，含按实例配置和 workspace 自动生成

两种类型可在同一集群中共存。

## 功能

| 功能 | Profile 实例 | Docker 实例 |
|---|:---:|:---:|
| 集群总览（健康状态、CPU、内存、磁盘、运行时长） | ✓ | ✓ |
| 启动 / 停止 / 重启实例 | ✓ | ✓ |
| WebSocket 实时日志流 | ✓ | ✓ |
| 按实例编辑 `openclaw.json` | ✓ | ✓ |
| 通过反向代理嵌入 Control UI | ✓ | ✓ |
| 设备审批与飞书配对 | ✓ | ✓ |
| 多用户访问，支持 admin/user 角色 | ✓ | ✓ |
| 创建 / 删除实例 | ✓ | ✓ |
| 插件安装 / 卸载 | ✓ | ✓ |
| 在实例类型之间迁移 | ✓ | ✓ |
| 崩溃后自动重启 | ✓ | — |
| Tailscale 每实例 HTTPS 访问地址 | — | ✓ |

## 截图

<table>
  <tr>
    <td align="center"><b>实时日志</b></td>
    <td align="center"><b>性能指标</b></td>
    <td align="center"><b>用户管理</b></td>
  </tr>
  <tr>
    <td><img src="docs/guides/screenshots/06-logs-tab.png" alt="实时日志流" width="260"/></td>
    <td><img src="docs/guides/screenshots/06-metrics-tab.png" alt="CPU 性能图表" width="260"/></td>
    <td><img src="docs/guides/screenshots/03-users-panel.png" alt="用户管理" width="260"/></td>
  </tr>
</table>

## 快速开始

1. 安装依赖：

```bash
npm install
```

2. 创建服务端配置：

```bash
cp packages/server/server.config.example.json packages/server/server.config.json
```

3. 编辑 `packages/server/server.config.json`：
   - 将 `fleetDir` 设置为你的 fleet 目录
   - `auth.username` / `auth.password` 用于首次启动时初始化管理员账号
   - 可选：添加 `profiles` 块自定义 Profile 实例设置（二进制路径、端口、自动重启等，字段说明见示例配置）。Profile 支持始终启用，缺省时使用内置默认值。避免使用 `main` 作为 profile 名称 —— OpenClaw 为独立默认 profile 保留了该名称。
   - Docker 实例在 Docker 可用时开箱即用。Fleet manager 会自动创建 `config/fleet.env`、`.env`、按实例的 `openclaw.json` 和 workspace 目录，无需 `docker compose` 或额外初始化脚本。
   - **TLS** — Control UI 的设备认证需要安全上下文，因此 TLS 是必须的。本地开发可以生成自签名证书：
     ```bash
     openssl req -x509 -newkey rsa:4096 -nodes -days 365 \
       -keyout key.pem -out cert.pem \
       -subj "/CN=localhost" \
       -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
     ```
     然后在 `server.config.json` 中将 `tls.cert` 和 `tls.key` 设置为生成文件的路径。使用自签名证书时浏览器会显示安全警告，接受一次即可继续。

4. 创建前端环境变量文件：

```bash
cp packages/web/.env.example packages/web/.env.local
```

5. 在 `.env.local` 中设置 `VITE_BASIC_AUTH_USER` 和 `VITE_BASIC_AUTH_PASSWORD`，与服务端配置保持一致。

6. 启动：

```bash
npm run dev
```

管理面板运行在 `http://localhost:5173`，API 服务运行在 `https://localhost:3001`（若已移除 TLS 则为 `http://`）。

## 架构

```text
┌──────────────────────────────────────────────────────────────────┐
│  浏览器  →  React 管理面板 (Vite)  →  Fastify API 服务           │
│                                          ├─ 认证与用户管理        │
│                                          ├─ 集群配置             │
│                                          └─ 日志 / UI 代理       │
└──────────────────────────────────────────────────────────────────┘
                              │
                  HybridBackend（始终启用）
              ┌───────────────┴───────────────┐
        ProfileBackend                  DockerBackend
  openclaw --profile <name>          openclaw-N 容器
  配置目录 / 状态目录 / workspace     config/N  workspace/N
```

完整架构说明请参阅 [docs/arch/README_CN.md](docs/arch/README_CN.md)。

日常管理操作请参阅[管理员指南](docs/guides/admin-guide-cn.md)和[快速参考](docs/guides/admin-quick-reference-cn.md)。

## 常用命令

```bash
npm run dev      # 启动服务端（3001 端口）和管理面板（5173 端口）
npm run build    # 编译两个包
npm run test     # 运行服务端测试
npm run lint     # 检查前端代码
npm run test:e2e # 运行 Playwright 冒烟测试
```

## Playwright 冒烟测试

`npm run test:e2e` 需要以下两类环境变量中的至少一种：

```bash
# 指向一个已经启动的部署
PLAYWRIGHT_BASE_URL=https://localhost:3001 npm run test:e2e

# 或让 Playwright 在测试期间启动应用
PLAYWRIGHT_SERVER_COMMAND="npm run dev" PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npm run test:e2e
```

认证冒烟测试会从环境变量读取账号信息；如果未提供，会自动跳过而不是失败：

```bash
PLAYWRIGHT_USER_USERNAME=testuser \
PLAYWRIGHT_USER_PASSWORD=testuser \
PLAYWRIGHT_ADMIN_USERNAME=admin \
PLAYWRIGHT_ADMIN_PASSWORD=changeme \
PLAYWRIGHT_BASE_URL=https://localhost:3001 \
npm run test:e2e
```

## 许可证

Apache 2.0。见 [LICENSE](LICENSE)。
