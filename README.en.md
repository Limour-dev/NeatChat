<div align="center">

![](https://raw.githubusercontent.com/tianzhentech/static/main/images/NeatChat-Dark.svg)

![Stars](https://img.shields.io/github/stars/tianzhentech/neatchat)
![Forks](https://img.shields.io/github/forks/tianzhentech/neatchat)
![Release Badge](https://img.shields.io/github/v/release/tianzhentech/neatchat.svg)
![License](https://img.shields.io/github/license/tianzhentech/neatchat.svg)

简体中文 | [English](README.en.md)

Built on a deep refactoring of NextChat: A more elegant and powerful AI conversation solution
</div>

## ⚡ Quick Start

1. **Docker (recommended, the only primary way)**: The image is built automatically by GitHub Actions (`.github/workflows/docker.yml`) and pushed to Docker Hub: `limour/next-chat`. Create a `docker-compose.yml`: 

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
      - HOSTNAME=0.0.0.0
      - DEFAULT_MODEL=ChatGPT
    restart: unless-stopped
```

Start and visit:

```bash
docker compose up -d
# visit http://<server-ip>:3000 in your browser
```

> See `.env.template` for all other environment variables; other configs remain consistent with the official version. For detailed usage, refer to [NextChat](https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web)
