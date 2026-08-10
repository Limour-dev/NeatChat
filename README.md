<div align="center">


![](https://raw.githubusercontent.com/tianzhentech/static/main/images/NeatChat-Dark.svg)

![Stars](https://img.shields.io/github/stars/tianzhentech/neatchat)
![Forks](https://img.shields.io/github/forks/tianzhentech/neatchat)
![Release Badge](https://img.shields.io/github/v/release/tianzhentech/neatchat.svg)
![License](https://img.shields.io/github/license/tianzhentech/neatchat.svg)

简体中文 | [English](README.en.md)

基于 NextChat 深度重构，一个更优雅、更强大的 AI 对话解决方案
</div>

## ⚡ 快速开始

1. **Docker 启动（推荐，唯一主推方式）**：镜像由 GitHub Actions（`.github/workflows/docker.yml`）自动构建并推送至 Docker Hub：`limour/next-chat`。新建 `docker-compose.yml`：

```yaml
version: '3'
services:
  next-web:
    image: limour/next-chat
    ports:
      - "3000:3000"
    environment:
      - TZ=Asia/Shanghai
      - BASE_URL=https://xxxx
      - CUSTOM_MODELS=ChatGPT@OpenAI
      # 默认 openai-responses；由用户在环境变量中显式指定，不根据模型名推断
      - API_FORMAT=openai-responses
      - ENABLE_BALANCE_QUERY=1
      - HOSTNAME=0.0.0.0
      - DEFAULT_MODEL=ChatGPT
    restart: unless-stopped
```

启动并访问：

```bash
docker compose up -d
# 浏览器访问 http://<服务器IP>:3000
```

> 其余环境变量见 `.env.template`；其余配置与官方一致，详细使用请参考[NextChat](https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web)