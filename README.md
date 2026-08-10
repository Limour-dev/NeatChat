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

我重新定义了CUSTOM_MODELS中@之后的变量，比如原来你可以使用gpt-4o@OpenAI，其中OpenAI作为providers存在，也约束了请求方式是openai格式，但是当后来越来越多的模型都以openai格式作为规范，再@openai就显得很奇怪，也会出现一些问题。现在，我建议在我的版本中，使用`@模型类别`这个方式来约束模型。（当然原来的方式仍然保留，只是扩充了@的用法）

> 当然你不用自己操作，客户端我已经做了自动配置，我只是建议在服务端设置变量的时候就`@模型类别`，后续我将围绕这个类别做一些更新。

所有类别：

| 类别         | 匹配规则           | 类别       | 匹配规则         |
| ------------ | ------------------ | ---------- | ---------------- |
| Claude       | `claude`           | DALL-E     | `dall`           |
| DeepSeek     | `deepseek`         | Grok       | `grok`           |
| Gemini       | `gemini`           | MoonShot   | `moonshot\|kimi` |
| WenXin       | `wenxin\|ernie`    | DouBao     | `doubao`         |
| HunYuan      | `hunyuan`          | Cohere     | `command`        |
| GLM          | `glm`              | Llama      | `llama`          |
| Qwen         | `qwen\|qwq\|qvq`   | ChatGPT    | `gpt\|o1\|o3`    |
| Mistral      | `mistral`          | Yi         | `yi`             |
| SenseNova    | `sensenova\|sense` | Spark      | `spark`          |
| MiniMax      | `minimax\|abab`    | HaiLuo     | `hailuo`         |
| Gemma        | `gemma`            | StepFun    | `stepfun`        |
| Ollama       | `ollama`           | ComfyUI    | `comfyui`        |
| VolcEngine   | `volcengine`       | VertexAI   | `vertexai`       |
| SiliconCloud | `siliconcloud`     | Perplexity | `perplexity`     |
| Stability    | `stability`        | Flux       | `flux`           |

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
      - CUSTOM_MODELS=-all,+gpt-4o-mini@Deepbricks,+ChatGPT@OpenAI,+claude@OpenRouter,+gemini@Vertex
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


## 🚢 版本说明

| 类型           | 状态   | 标识规则                         | 稳定性 | 生命周期           | 原分支替代关系     |
| -------------- | ------ | -------------------------------- | ------ | ------------------ | ------------------ |
| **预发行版**   | 🔄 活跃 | 与正式版版号一致，但有预发行标签 | ⚠️ 测试 | 会多次合并提交     | 替代原preview分支  |
| **正式发行版** | ✅ 稳定 | `vX.Y.Z`                         | ✔️ 生产 | 由预发行稳定后诞生 | 合并原mini分支特性 |
| preview分支    | 🚫 废弃 | -                                | -      | 已合并到main分支   | 功能由预发行版承接 |
| mini分支       | 🚫 废弃 | -                                | -      | 特性已整合到正式版 | 不再独立维护       |