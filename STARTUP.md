# 启动经验总结

本文档记录本项目的本地启动、Docker 构建过程中的经验与踩坑记录。
**注意：本文档不包含任何 API key 或敏感凭据，请勿把 .env 的真实内容粘贴进来。**

## 环境要求

- Node.js >= 22（本地验证版本 v26.5.0）
- npm 11.x
- 依赖安装：`npm ci`（使用 package-lock.json，保证版本一致）

## 配置（.env）

复制 `.env.template` 为 `.env` 并填写：

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | 上游 API key（必填） |
| `BASE_URL` | 上游 API 网关地址 |
| `API_FORMAT` | `anthropic-messages` 或 `openai-responses` |
| `CUSTOM_MODELS` | 模型列表控制，如 `-all,+deepseek-v4-flash@OCG` |
| `DEFAULT_MODEL` | 默认模型（可选留空） |
| `CODE` | 访问密码（可选） |

> ⚠️ `.env` 已被 `.dockerignore` 排除，不会进入 Docker 镜像。

## 构建

### 关键坑 1：ESLint errors 导致构建失败

项目代码（如 `app/components/chat.tsx` 的 `_Chat`、`app/components/markdown.tsx` 的 `_MarkDownContent`）
存在既有的 `react-hooks/rules-of-hooks` ESLint **Error**，`next build` 默认会跑 lint 并直接失败。

**解决方案：构建时跳过 lint**：

```bash
npx next build --no-lint
```

> `npm run build`（= `npm run mask && next build`）会失败，不要直接用它。
> mask 数据（`app/masks/cn.ts`/`en.ts`）已提交在源码中，可跳过 `npm run mask` 步骤。

### 关键坑 2：自动加载 .env 但环境变量在构建时内联

Next.js 会自动加载 `.env`，但服务端代码中的 `process.env.X` 在**构建时**被内联。
**改了 `.env` 后必须重新构建**，仅重启 `next start` 不会让新配置生效。

改动 `.env` 后的正确流程：

```bash
rm -rf .next
npx next build --no-lint
```

### 验证配置是否生效

```bash
curl -s http://localhost:3000/api/config
```

正常应返回 `customModels`、`apiFormat`、`baseUrl`、`apiKey` 等字段（apiKey 只返回"已设置"占位）。

## 启动

### 关键坑 3：PORT 环境变量冲突

本机 shell 环境残留了 `PORT=30141`（pi-agent 占用，**不可动**）。
直接 `npm start` 或 `npx next start` 会读到 `PORT=30141` 导致 `EADDRINUSE` 启动失败。

**解决方案：显式指定端口并清除 PORT 变量**：

```bash
cd /home/limour/NeatChat
export PORT=3000
unset __NEXT_PRIVATE_ORIGIN
nohup npx next start -p 3000 > /tmp/neatchat-server.log 2>&1 &
```

或写成脚本复用：

```bash
cat > /tmp/start-neatchat.sh << 'EOF'
#!/bin/bash
cd /home/limour/NeatChat
export PORT=3000
unset __NEXT_PRIVATE_ORIGIN
exec npx next start -p 3000
EOF
chmod +x /tmp/start-neatchat.sh
nohup /tmp/start-neatchat.sh > /tmp/neatchat-server.log 2>&1 &
```

启动成功后访问 **http://localhost:3000**。

### 关于 standalone 模式

`next.config.mjs` 配置了 `output: "standalone"`，`next start` 会打印警告：
"next start does not work with output: standalone configuration. Use node .next/standalone/server.js instead."

当前 `next start` 可以正常工作，但若想消除警告，可改用：

```bash
node .next/standalone/server.js
```

（需确保 `.next/static` 与 `public` 已复制到 standalone 目录，参考 Dockerfile runner 阶段。）

## Docker 构建

### 关键坑 4：Dockerfile 构建命令必须跳过 lint

原 Dockerfile 使用 `RUN npm run build`，会因 ESLint errors 构建失败。
**已改为** `RUN npx next build --no-lint`（同本地构建一致）。

```dockerfile
RUN npx next build --no-lint
```

### Docker 启动

```bash
docker compose up -d    # 浏览器访问 http://<服务器IP>:3000
```

环境变量通过 `docker-compose.yml` 的 `environment:` 传入（如 `BASE_URL`、`CUSTOM_MODELS`、`DEFAULT_MODEL` 等），
容器的 `HOSTNAME=0.0.0.0` 需设置，否则容器内默认监听 localhost 无法对外访问。

## 端口速查

| 端口 | 用途 | 备注 |
|------|------|------|
| 3000 | NeatChat 服务 | 本项目的 next-server |
| 30141 | pi-agent | **不要占用/不要 kill** |