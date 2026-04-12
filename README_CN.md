# Claw Fleet Manager

<p align="center">
  <a href="README.md"><strong>English</strong></a>
</p>

<p align="center">
  <strong>在浏览器中管理 OpenClaw 集群。</strong><br/>
  用一个面板统一启停、配置和监控 Profile 实例与 Docker 实例。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge" alt="Apache 2.0 License"/>
  <img src="https://img.shields.io/badge/Node.js-20+-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 20+"/>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19"/>
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 8"/>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="docs/arch/README_CN.md">架构文档</a> ·
  <a href="docs/guides/installation-guide.md">安装指南（英文）</a> ·
  <a href="docs/guides/admin-guide-cn.md">管理员指南</a> ·
  <a href="docs/guides/admin-quick-reference-cn.md">快速参考</a> ·
  <a href="tests/README.md">Tests</a> ·
  <a href="tests/README_CN.md">测试说明</a>
</p>

<p align="center">
  <img src="docs/guides/screenshots/00-dashboard.png" alt="Claw Fleet Manager 管理面板" width="900"/>
</p>

**Claw Fleet Manager** 是一个用于管理多实例 OpenClaw 的 Web 控制台和 API 服务。

它支持一种**混合集群**模型：

- **Profile 实例**：基于原生 `openclaw --profile` 进程运行
- **Docker 实例**：基于受控的 `openclaw-N` 容器运行

两类实例可以在同一个 fleet 中并存，并共享统一的管理界面来处理生命周期操作、日志、配置、监控和访问控制。

## 为什么需要这个项目

当 OpenClaw 实例数量变多之后，运维工作很快会变得琐碎：账号和凭据、按实例配置、日志查看、健康检查、插件管理、异常重启处理。这个项目把这些工作集中到一个浏览器控制面里。

适合以下场景：

- 你管理的是一个实例集群，而不是单个本地实例
- 你希望给管理员或运营人员提供可用的图形化控制面
- 你需要在一个页面里查看健康状态、运行时长、CPU、内存和磁盘指标
- 你希望无需频繁 SSH 或进容器，也能查看日志和编辑配置
- 你需要在同一环境中同时管理原生 profile 部署和 Docker 部署

## 你可以做什么

| 能力 | Profile 实例 | Docker 实例 |
|---|:---:|:---:|
| 集群总览与健康指标 | ✓ | ✓ |
| 启动 / 停止 / 重启实例 | ✓ | ✓ |
| 通过 WebSocket 实时查看日志 | ✓ | ✓ |
| 编辑按实例划分的 `openclaw.json` | ✓ | ✓ |
| 通过反向代理嵌入 Control UI | ✓ | ✓ |
| 设备审批与飞书配对 | ✓ | ✓ |
| 多用户访问与 admin / user 角色 | ✓ | ✓ |
| 创建 / 删除实例 | ✓ | ✓ |
| 安装 / 卸载插件 | ✓ | ✓ |
| 在两类实例之间迁移 | ✓ | ✓ |
| 崩溃后自动重启 | ✓ | — |
| 每实例独立的 Tailscale HTTPS 地址 | — | ✓ |

## 截图

<table>
  <tr>
    <td align="center"><b>实时日志</b></td>
    <td align="center"><b>性能指标</b></td>
    <td align="center"><b>用户管理</b></td>
  </tr>
  <tr>
    <td><img src="docs/guides/screenshots/06-logs-tab.png" alt="实时日志流" width="260"/></td>
    <td><img src="docs/guides/screenshots/06-metrics-tab.png" alt="CPU 与内存指标" width="260"/></td>
    <td><img src="docs/guides/screenshots/03-users-panel.png" alt="用户管理面板" width="260"/></td>
  </tr>
</table>

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 创建服务端配置

```bash
cp packages/server/server.config.example.json packages/server/server.config.json
```

### 3. 编辑 `packages/server/server.config.json`

最小配置：

- 先创建 `fleetDir` 对应目录，再把 `fleetDir` 指向该目录
- 设置 `auth.username` 和 `auth.password`，用于首次启动时初始化管理员账号
- 如需本地测试，可将 `seedTestUser` 设为 `true` 来预置普通用户 `testuser`（密码 `testuser`）
- 如果不打算使用 Tailscale，删除 `tailscale` 配置块

生产环境加固建议：

- 将 `auth.password` 改为强密码
- 若启用了 `seedTestUser`，服务启动后以管理员身份删除 `testuser`：

```bash
curl -k -u admin:新管理员密码 -X DELETE https://localhost:3001/api/users/testuser
```

- 或直接删除 `${fleetDir}/users.json` 中的 `testuser` 后重启服务

可选的 Profile 配置：

- 可以增加 `profiles` 配置块，自定义 Profile 实例默认项，例如二进制路径、端口和自动重启
- 不要使用 `main` 作为 profile 名称，因为 OpenClaw 为默认独立 profile 保留了这个名字

Docker 行为：

- 只要系统中 Docker 可用，就可以直接使用 Docker 实例
- fleet manager 会按需创建 `config/fleet.env`、`.env`、按实例的 `openclaw.json` 以及 workspace 脚手架

TLS 说明：

- 嵌入式 Control UI 依赖安全上下文，因此 TLS 是必需的
- 本地开发可以先生成一个自签名证书：

```bash
openssl req -x509 -newkey rsa:4096 -nodes -days 365 \
  -keyout key.pem -out cert.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

然后在 `server.config.json` 中把 `tls.cert` 和 `tls.key` 指向这两个文件。浏览器会对自签名证书提示一次风险警告，本地接受后即可继续。

### 4. 创建前端环境变量文件

```bash
cp packages/web/.env.example packages/web/.env.local
```

将以下变量设置为与服务端配置一致：

- `VITE_BASIC_AUTH_USER`
- `VITE_BASIC_AUTH_PASSWORD`

### 5. 启动应用

```bash
npm run dev
```

默认本地地址：

- 管理面板：`http://localhost:5173`
- API 服务：`https://localhost:3001`

## 仓库结构

```text
.
├─ packages/server   Fastify API 服务、fleet 后端、认证、日志、代理
├─ packages/web      React + Vite 管理面板
├─ tests/e2e         Playwright 端到端与冒烟测试
└─ docs              架构文档与运维指南
```

## 架构

```text
┌─────────────────────────────────────────────────────────────┐
│  浏览器  →  React 管理面板 (Vite)  →  Fastify API 服务       │
│                                          ├─ 认证与用户管理   │
│                                          ├─ Fleet 配置      │
│                                          └─ 日志 / 代理     │
└─────────────────────────────────────────────────────────────┘
                              │
                    HybridBackend（始终启用）
              ┌───────────────┴───────────────┐
      ProfileBackend                    DockerBackend
  openclaw --profile <name>          openclaw-N 容器
  配置 / 状态 / workspace            按实例配置 / workspace
```

完整架构说明见 [docs/arch/README_CN.md](docs/arch/README_CN.md)。

## 开发命令

```bash
npm run dev      # 以 watch 模式启动管理面板和 API 服务
npm run build    # 构建两个 package
npm run test     # 运行工作区测试
npm run lint     # 检查前端代码
npm run test:e2e # 运行 Playwright 端到端测试
```

Playwright 的环境变量、启动方式和认证冒烟测试说明见 [tests/README.md](tests/README.md)。

## 文档

- [docs/guides/installation-guide.md](docs/guides/installation-guide.md)（英文）
- [docs/guides/admin-guide-cn.md](docs/guides/admin-guide-cn.md)
- [docs/guides/admin-quick-reference-cn.md](docs/guides/admin-quick-reference-cn.md)
- [docs/arch/README_CN.md](docs/arch/README_CN.md)

## 许可证

Apache 2.0。见 [LICENSE](LICENSE)。
