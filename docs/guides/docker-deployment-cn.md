# Claw Fleet Manager — Docker 部署

适用场景：将 fleet manager 本身运行在 Docker 中，并通过宿主机 Docker daemon 管理 Docker 实例。

## 快速开始

```bash
chmod +x scripts/docker-deploy.sh
./scripts/docker-deploy.sh
```

默认结果：

| 默认值 | 内容 |
|---|---|
| 管理面板地址 | `http://localhost:3001` |
| 管理员登录 | `admin` / `changeme` |
| 数据目录 | `.docker-data/claw-fleet-manager` |

## 注意事项

- 此部署方式**仅适用于 Docker 实例**。
- 脚本会挂载 `/var/run/docker.sock`，fleet manager 将直接控制宿主机的 Docker daemon。
- 脚本会将数据目录以**相同的绝对路径**挂载到容器内，这是 manager 创建 Docker bind mount 正常工作的必要条件。
- 新托管实例默认使用的 OpenClaw 镜像为 `openclaw:local`。

## 环境变量覆盖

```bash
ADMIN_USER=ops \
ADMIN_PASSWORD='change-this-now' \
MANAGER_PORT=3002 \
OPENCLAW_IMAGE=ghcr.io/your-org/openclaw:latest \
./scripts/docker-deploy.sh
```

## TLS

如需通过 HTTPS 启用嵌入式 Control UI，传入已有的证书文件：

```bash
TLS_CERT=/abs/path/cert.pem TLS_KEY=/abs/path/key.pem ./scripts/docker-deploy.sh
```

数据目录之外的证书路径会被自动以只读方式挂载。

## 新 Docker 实例的默认 API 配置

为新创建的 Docker 实例设置默认 API 凭据：

```bash
BASE_URL=https://api.openai.com/v1 \
MODEL_ID=gpt-4o-mini \
API_KEY=sk-... \
./scripts/docker-deploy.sh
```

## 管理部署

```bash
docker rm -f claw-fleet-manager        # 停止并移除
docker logs -f claw-fleet-manager      # 持续查看日志
```
