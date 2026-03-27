# Claw Fleet Manager

[English](README.md)

在浏览器中管理 `openclaw` 集群 —— 无需命令行，即可启停实例、编辑配置、查看监控。

支持两种部署后端：

- **Profile 模式**（推荐）：直接管理原生 `openclaw --profile` 网关进程
- **Docker 模式**：管理现有 fleet 目录中的 `openclaw-N` 容器

## 功能

| 功能 | Profile | Docker |
|---|:---:|:---:|
| 集群总览（健康状态、CPU、内存、磁盘、运行时长） | ✓ | ✓ |
| 启动 / 停止 / 重启实例 | ✓ | ✓ |
| WebSocket 实时日志流 | ✓ | ✓ |
| 按实例编辑 `openclaw.json` | ✓ | ✓ |
| 通过反向代理嵌入 Control UI | ✓ | ✓ |
| 设备审批与飞书配对 | ✓ | ✓ |
| 多用户访问，支持 admin/user 角色 | ✓ | ✓ |
| 创建 / 删除实例 | ✓ | — |
| 插件安装 / 卸载 | ✓ | — |
| 崩溃后自动重启 | ✓ | — |
| 集群扩缩容 | — | ✓ |
| Tailscale 每实例 HTTPS 访问地址 | — | ✓ |

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
   - 将 `deploymentMode` 设置为 `"profiles"`（推荐）或 `"docker"`
   - `auth.username` / `auth.password` 用于首次启动时初始化管理员账号
   - 如需远程访问，请配置 `tls.cert` 和 `tls.key`（安全上下文所需）

4. 创建前端环境变量文件：

```bash
cp packages/web/.env.example packages/web/.env.local
```

5. 在 `.env.local` 中设置 `VITE_BASIC_AUTH_USER` 和 `VITE_BASIC_AUTH_PASSWORD`，与服务端配置保持一致。

6. 启动：

```bash
npm run dev
```

管理面板运行在 `http://localhost:5173`，API 服务运行在 `https://localhost:3001`。

> 如果想在开发环境中不启用 TLS，请将 `packages/web/vite.config.ts` 中的代理目标改为 `http://localhost:3001`。

## 架构

```text
┌──────────────────────────────────────────────────────────────────┐
│  浏览器  →  React 管理面板 (Vite)  →  Fastify API 服务           │
│                                          ├─ 认证与用户管理        │
│                                          ├─ 集群配置             │
│                                          └─ 日志 / UI 代理       │
└──────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
         Profile 模式                     Docker 模式
   openclaw --profile <name>          openclaw-N 容器
   配置目录 / 状态目录 / workspace     config/N  workspace/N
```

完整架构说明请参阅 [docs/arch/README_CN.md](docs/arch/README_CN.md)。

## 常用命令

```bash
npm run dev      # 启动服务端（3001 端口）和管理面板（5173 端口）
npm run build    # 编译两个包
npm run test     # 运行服务端测试
npm run lint     # 检查前端代码
```

## 许可证

Apache 2.0。见 [LICENSE](LICENSE)。
