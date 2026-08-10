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

I have redefined the variables after `@` in `CUSTOM_MODELS`. For example, previously you could use `gpt-4o@OpenAI`, where `OpenAI` served as the provider and constrained the request format to OpenAI. However, as more models adopt the OpenAI format as the standard, using `@openai` became awkward and caused issues. Now, in my version, I recommend using `@model_category` to constrain the model. (The original method is still supported, but the `@` usage has been expanded.)

> You don’t need to do this manually; the client automatically handles the configuration. I simply recommend setting the variable on the server side with `@model_category`. Future updates will focus on this category.

All categories:

| Category      | Matching Rule         | Category    | Matching Rule       |
| ------------- | --------------------- | ----------- | ------------------- |
| Claude        | `claude`             | DALL-E      | `dall`             |
| DeepSeek      | `deepseek`           | Grok        | `grok`             |
| Gemini        | `gemini`             | MoonShot    | `moonshot\|kimi`   |
| WenXin        | `wenxin\|ernie`      | DouBao      | `doubao`           |
| HunYuan       | `hunyuan`            | Cohere      | `command`          |
| GLM           | `glm`                | Llama       | `llama`            |
| Qwen          | `qwen\|qwq\|qvq`     | ChatGPT     | `gpt\|o1\|o3`      |
| Mistral       | `mistral`            | Yi          | `yi`               |
| SenseNova     | `sensenova\|sense`   | Spark       | `spark`            |
| MiniMax       | `minimax\|abab`      | HaiLuo      | `hailuo`           |
| Gemma         | `gemma`              | StepFun     | `stepfun`          |
| Ollama        | `ollama`             | ComfyUI     | `comfyui`          |
| VolcEngine    | `volcengine`         | VertexAI    | `vertexai`         |
| SiliconCloud  | `siliconcloud`       | Perplexity  | `perplexity`       |
| Flux          | `flux`               |             |                    |
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
      - CUSTOM_MODELS=-all,+gpt-4o-mini@Deepbricks,+ChatGPT@OpenAI,+claude@OpenRouter,+gemini@Vertex
      - ENABLE_BALANCE_QUERY=1
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


## 🚢 Version Notes

| Type          | Status | Label Rules                     | Stability | Lifecycle          | Original Branch Replacement |
| ------------- | ------ | ------------------------------- | --------- | ------------------ | -------------------------- |
| **Pre-release** | 🔄 Active | Same version as stable, with pre-release tag | ⚠️ Testing | Frequent commits   | Replaces original preview branch |
| **Stable Release** | ✅ Stable | `vX.Y.Z`                         | ✔️ Production | Born from pre-release stability | Merges features from original mini branch |
| preview branch | 🚫 Deprecated | -                                | -          | Merged into main branch | Features handled by pre-release |
| mini branch    | 🚫 Deprecated | -                                | -          | Features integrated into stable version | No longer maintained independently |
