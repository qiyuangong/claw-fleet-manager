# 测试说明

<p align="center">
  <a href="README.md"><strong>English</strong></a>
</p>

本目录包含项目的 Playwright 端到端测试，以及相关测试文件。

## 目录结构

```text
tests/
└─ e2e/
   ├─ auth-smoke.spec.ts
   ├─ screenshot-guide.spec.ts
   └─ ui-merge.spec.ts
```

## 运行 Playwright 测试

在仓库根目录执行：

```bash
npm run test:e2e
```

## 运行时必需配置

Playwright 运行器需要满足以下两种方式中的一种：

1. 提供一个已经启动的部署地址
2. 提供一个可用于启动应用的命令

### 方式 1：指向已运行的部署

```bash
PLAYWRIGHT_BASE_URL=https://localhost:3001 npm run test:e2e
```

### 方式 2：让 Playwright 自己启动应用

```bash
PLAYWRIGHT_SERVER_COMMAND="npm run dev" \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 \
npm run test:e2e
```

## 认证冒烟测试

认证相关测试会从环境变量中读取账号信息。如果没有提供，这部分测试会自动跳过。

```bash
PLAYWRIGHT_USER_USERNAME=testuser \
PLAYWRIGHT_USER_PASSWORD=testuser \
PLAYWRIGHT_ADMIN_USERNAME=admin \
PLAYWRIGHT_ADMIN_PASSWORD=changeme \
PLAYWRIGHT_BASE_URL=https://localhost:3001 \
npm run test:e2e
```

## 备注

- `PLAYWRIGHT_BASE_URL` 应指向你希望测试的 UI 入口地址
- 涉及安全上下文的流程时，优先使用 HTTPS
- 如果本地使用自签名 TLS，请先确保浏览器会话已经信任或接受该目标环境
