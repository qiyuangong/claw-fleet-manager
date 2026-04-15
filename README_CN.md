# Claw Fleet Manager

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

<p align="center">
  <strong>在浏览器中管理 OpenClaw 与 Hermes 集群。</strong><br/>
  用一个面板统一启停、配置和监控 OpenClaw Profile 实例、OpenClaw Docker 实例以及 Hermes Docker 实例。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge" alt="Apache 2.0 License"/>
  <img src="https://img.shields.io/badge/Node.js-20+-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 20+"/>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19"/>
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 8"/>
</p>

<p align="center">
  <a href="docs/arch/README_CN.md">架构文档</a> ·
  <a href="docs/guides/installation-guide-cn.md">安装指南</a> ·
  <a href="docs/guides/docker-deployment-cn.md">Docker 部署</a> ·
  <a href="docs/guides/admin-guide-cn.md">管理员指南</a> ·
  <a href="docs/guides/admin-quick-reference-cn.md">快速参考</a> ·
  <a href="tests/README_CN.md">测试说明</a>
</p>

<p align="center">
  <img src="docs/guides/screenshots/00-dashboard.png" alt="Claw Fleet Manager 管理面板" width="900"/>
</p>

**Claw Fleet Manager** 是一个用于管理多实例 OpenClaw 与 Hermes 网关的 Web 控制台和 API 服务。

它支持一种**混合集群**模型 —— OpenClaw Profile 实例、OpenClaw Docker 实例与 Hermes Docker 实例可在同一面板中统一管理，共享生命周期操作、日志、配置编辑、监控指标和访问控制。

适合以下场景：

- 你管理的是一个混合运行时的实例集群，而非单个本地实例
- 你希望给管理员或运营人员提供可用的图形化控制面
- 你需要在一个页面里查看健康状态、运行时长、CPU、内存和磁盘指标
- 你希望无需频繁 SSH 或进容器，也能查看日志和编辑配置
- 你需要在同一环境中同时管理原生 Profile 部署和 Docker 部署

## 你可以做什么

| 能力 | Profile 实例 | OpenClaw Docker | Hermes Docker |
|---|:---:|:---:|:---:|
| 集群总览与健康指标 | ✓ | ✓ | ✓ |
| 启动 / 停止 / 重启实例 | ✓ | ✓ | ✓ |
| 通过 WebSocket 实时查看日志 | ✓ | ✓ | ✓ |
| 编辑按实例配置 | ✓ | ✓ | ✓ |
| 多用户访问与 admin / user 角色 | ✓ | ✓ | ✓ |
| 创建 / 删除 / 重命名实例 | ✓ | ✓ | ✓ |
| 通过反向代理嵌入 Control UI | ✓ | ✓ | — |
| 设备审批与飞书配对 | ✓ | ✓ | — |
| 安装 / 卸载插件 | ✓ | ✓ | — |
| 活动 / 会话标签页 | ✓ | ✓ | — |
| 在两类实例之间迁移 | ✓ | ✓ | — |
| 崩溃后自动重启 | ✓ | — | — |
| 每实例独立的 Tailscale HTTPS 地址 | — | ✓ | — |

Hermes 实例与 OpenClaw 实例共用同一集群列表；OpenClaw 专属功能对 Hermes 实例自动隐藏。

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
  <tr>
    <td align="center"><b>配置编辑</b></td>
    <td align="center"><b>插件管理</b></td>
    <td align="center"><b>Control UI</b></td>
  </tr>
  <tr>
    <td><img src="docs/guides/screenshots/08-config-tab.png" alt="按实例配置编辑器" width="260"/></td>
    <td><img src="docs/guides/screenshots/07-plugins-tab.png" alt="插件管理" width="260"/></td>
    <td><img src="docs/guides/screenshots/04-controlui-pending.png" alt="嵌入式 Control UI" width="260"/></td>
  </tr>
</table>

## 快速开始

```bash
npm install
cp packages/server/server.config.example.json packages/server/server.config.json
cp packages/web/.env.example packages/web/.env.local
npm run dev
```

启动前请编辑 `packages/server/server.config.json`：

- 设置 `fleetDir`、`auth.username` 和 `auth.password`
- 删除 `tls` 配置块（或将其指向真实的证书文件）—— 服务启动时会直接读取这些文件，路径为占位符则会报错
- 如未安装并配置 Tailscale，删除 `tailscale` 配置块

默认本地地址：

- 管理面板：`http://localhost:5173`
- API 服务：`https://localhost:3001`

→ 完整安装说明：[安装指南](docs/guides/installation-guide-cn.md)

## Docker 部署

```bash
chmod +x scripts/docker-deploy.sh
./scripts/docker-deploy.sh
```

| 默认值 | 内容 |
|---|---|
| 管理面板地址 | `http://localhost:3001` |
| 管理员登录 | `admin` / `changeme` |
| 数据目录 | `.docker-data/claw-fleet-manager` |

→ 环境变量覆盖、TLS 和镜像配置：[Docker 部署指南](docs/guides/docker-deployment-cn.md)

## 架构

```text
         浏览器
            │
            ▼
    ┌───────────────────────────┐
    │    React 管理面板          │
    │         (Vite)            │
    └────────────┬──────────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │    Fastify API 服务        │
    │      ├─ 认证与用户管理     │
    │      ├─ Fleet 配置        │
    │      └─ 日志 / 代理       │
    └────────────┬──────────────┘
                 │
          HybridBackend
    ┌────────────┼────────────┐
    │            │             │
ProfileBackend  DockerBackend  HermesDockerBackend
openclaw        openclaw-N     hermes
--profile       容器           容器
```

完整架构说明见 [docs/arch/README_CN.md](docs/arch/README_CN.md)。

## 文档

- [docs/guides/installation-guide-cn.md](docs/guides/installation-guide-cn.md)
- [docs/guides/docker-deployment-cn.md](docs/guides/docker-deployment-cn.md)
- [docs/guides/admin-guide-cn.md](docs/guides/admin-guide-cn.md)
- [docs/guides/admin-quick-reference-cn.md](docs/guides/admin-quick-reference-cn.md)
- [docs/guides/development-cn.md](docs/guides/development-cn.md)
- [docs/arch/README_CN.md](docs/arch/README_CN.md)

## 许可证

Apache 2.0。见 [LICENSE](LICENSE)。
