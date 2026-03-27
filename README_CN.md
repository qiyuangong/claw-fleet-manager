# Claw Fleet Manager

Claw Fleet Manager 是一个基于 Turbo 和 npm workspaces 的 monorepo，用于在浏览器中管理 `openclaw` 集群。

- `packages/server`：基于 Fastify 的 API，负责认证、集群编排、配置读写、日志流和反向代理
- `packages/web`：基于 React 19 + Vite 的管理面板，用于查看集群状态、编辑配置、查看指标和日志，以及执行实例操作

服务端支持两种部署后端：

- `profiles`：不依赖 Docker，直接管理原生 `openclaw` profile 进程
- `docker`：在现有 fleet 目录中管理 `openclaw-*` 容器

## 功能

- 集群总览，包含缓存状态刷新、健康状态、CPU、内存、磁盘、运行时长和镜像信息
- 启动、停止和重启单个实例
- 集群级配置编辑，并在需要时支持 Docker 模式下的 fleet 扩缩容
- 按实例编辑 `openclaw.json`
- 通过 WebSocket 实时查看日志流
- 通过已认证反向代理嵌入 Control UI
- 在面板中处理设备审批和飞书配对流程
- 在 profile 模式下创建/删除实例，以及安装/卸载插件
- 多用户访问，支持持久化用户、admin/user 角色和按 profile 分配权限
- 提供管理员界面，用于创建用户、重置密码和授权 profile 访问
- 可选的 Tailscale 集成，为每个实例生成独立 URL

## 仓库结构

```text
.
├── packages/
│   ├── server/   Fastify server, backends, routes, tests
│   └── web/      React/Vite dashboard
├── docs/arch/    architecture notes
├── turbo.json    workspace task graph
└── README.md
```

## Architecture

浏览器先访问 React 管理面板，再由管理面板调用 Fastify API。管理服务负责用户、配置、日志和 Control UI 代理，并优先管理原生 profile 模式网关，同时也支持 Docker 模式的 `openclaw-N` 实例作为替代后端。

```text
┌────────────────────────────── 浏览器 / UI ───────────────────────────────┐
│                                                                          │
│  浏览器  -->  Web 管理面板 (React + Vite)  -->  Fastify API 服务         │
│                                                     │                    │
│                                                     ├─ users.json        │
│                                                     ├─ fleet 配置        │
│                                                     └─ 日志 / UI 代理    │
└──────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────── 受管运行时 ────────────────────────────────┐
│                                                                          │
│  Profile 模式：profile-a    profile-b    ...   profile-n                │
│               openclaw --profile <name> gateway                         │
│               配置目录      状态目录      workspace 目录                │
│                                                                          │
│  Docker 模式： openclaw-1   openclaw-2   ...   openclaw-N               │
│               config/1     config/2           config/N                  │
│               workspace/1  workspace/2        workspace/N               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## 运行要求

根据你的部署模式选择对应依赖：

- 所有模式：安装支持 npm workspaces 的 Node.js，并执行 `npm install`
- Profile 模式：确保 `openclaw` 可通过 `PATH` 访问
- Docker 模式：安装 Docker / Docker Compose，并准备好一个现有的 openclaw fleet 目录
- 可选：如果配置了 `tailscale.hostname`，还需要安装 `tailscale` CLI

## 认证与用户

- 服务端会将用户信息存储在 `fleetDir` 下的 `users.json` 中。
- 首次启动时，会使用 `server.config.json.auth` 中的凭据初始化第一个 `admin` 用户。
- 之后系统会改为基于用户认证，而不是使用单一共享密码文件。
- `admin` 用户可以访问所有实例、管理用户、重置密码以及分配 profile 访问权限。
- `user` 用户可以登录、修改自己的密码，并且只能看到分配给自己的 profile 模式实例。

## 本地开发

1. 安装依赖：

```bash
npm install
```

2. 创建服务端配置：

```bash
cp packages/server/server.config.example.json packages/server/server.config.json
```

3. 编辑 `packages/server/server.config.json`。

- 将 `fleetDir` 设置为你的实际 fleet 目录。
- 如果你更想使用灵活的多 profile 方案，请设置 `deploymentMode: "profiles"` 并补全 `profiles` 配置块。
- 只有在你需要管理现有容器集群时，再使用 `deploymentMode: "docker"`。
- `auth.username` 和 `auth.password` 用于首次启动时初始化管理员账号。
- 当前 Vite 开发代理目标是 `https://localhost:3001`，因此默认的 `npm run dev` 流程要求在 `server.config.json` 中配置 `tls.cert` 和 `tls.key`。
- 如果你想在开发环境中让后端不启用 TLS，请修改 [`packages/web/vite.config.ts`](packages/web/vite.config.ts)，将代理目标改为 `http://localhost:3001`。

4. 创建前端环境变量文件：

```bash
cp packages/web/.env.example packages/web/.env.local
```

5. 在 `packages/web/.env.local` 中设置 `VITE_BASIC_AUTH_USER` 和 `VITE_BASIC_AUTH_PASSWORD`，并与 `packages/server/server.config.json` 中的配置保持一致。

6. 启动工作区：

```bash
npm run dev
```

这会在 `http://localhost:5173` 启动 Vite 应用，并在 `3001` 端口启动 Fastify 服务。

## 工作原理

- 前端应用会调用 `/api/*`，并使用来自 `packages/web/.env.local` 的 Basic Auth 请求头。
- 服务端会基于 `users.json` 对用户进行认证，并通过 Basic Auth、代理 Cookie 和短生命周期的 HMAC 代理令牌保护 HTTP、WebSocket 以及被代理的 Control UI 流量。
- 在生产构建中，如果 `packages/web/dist` 存在，服务端会直接托管这些静态资源。
- 前端外壳包含账户菜单、自助改密，以及仅管理员可见的用户管理界面。

关键服务端接口包括：

- `/api/health`
- `/api/fleet`
- `/api/fleet/scale`
- `/api/fleet/:id/start|stop|restart`
- `/api/fleet/:id/config`
- `/api/fleet/:id/token/reveal`
- `/api/fleet/:id/devices/pending`
- `/api/fleet/:id/feishu/pairing`
- Profile 模式下的 `/api/fleet/profiles` 和 `/api/fleet/:id/plugins*`
- `/api/users`、`/api/users/me`、`/api/users/:username/password` 和 `/api/users/:username/profiles`
- `/ws/logs` 和 `/ws/logs/:id`
- `/proxy/*` 和 `/proxy-ws/*`

如果你想进一步了解系统设计，请查看 [docs/arch/README_CN.md](docs/arch/README_CN.md)。

## 常用命令

在仓库根目录执行：

```bash
npm run dev
npm run build
npm run test
npm run lint
```

常用的包级命令：

```bash
npm --workspace @claw-fleet-manager/server run dev
npm --workspace @claw-fleet-manager/server run test
npm --workspace @claw-fleet-manager/web run dev
npm --workspace @claw-fleet-manager/web run build
npm --workspace @claw-fleet-manager/web run lint
```

## 测试

服务端包的路由与服务测试位于 `packages/server/tests`。

```bash
npm --workspace @claw-fleet-manager/server run test
```

## 许可证

Apache 2.0。见 [LICENSE](LICENSE)。
