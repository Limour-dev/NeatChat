# NeatChat 架构文档

> 本文档深入分析 NeatChat 的代码架构。NeatChat 是基于
> [ChatGPT-Next-Web (NextChat)](https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web)
> 深度重构的 AI 对话客户端，当前支持 Web / PWA / Windows / Linux / macOS 多端；
> 计划收敛为「仅 Linux 下 Docker 启动 + Web 访问」单一方式（见 §14 演进计划）。

- 技术栈：Next.js 14 (App Router) + React 18 + TypeScript + Zustand + Tauri 1.x (Rust)
- 状态管理：Zustand（`create` + `persist` 中间件）
- 数据持久化：IndexedDB（`idb-keyval`，localStorage 兜底）
- 多模态输入：文本、图片（含压缩/上传）、语音（TTS / 实时语音）、文件（Word/PDF/PPT/ZIP）
- 功能亮点：多模型提供商、插件（OpenAPI 转 function calling）、MCP 工具调用、Stable Diffusion 绘画、Artifacts、实时语音对话、云同步（WebDAV / Upstash）

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        浏览器 / PWA                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  UI 层 (app/components)                               │  │
│  │  chat / settings / mask / plugin / sd / mcp-market /  │  │
│  │  artifacts / realtime-chat / voice-print / search     │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ zustand hooks                   │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │  Store 层 (app/store)  纯前端全局状态                   │  │
│  │  chat / config / access / mask / prompt / plugin /    │  │
│  │  sync / update / sd      持久化→IndexedDB/localStorage │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ ClientApi (LLMApi 抽象)          │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │  客户端 API 层 (app/client)                            │  │
│  │  platforms/openai|google|anthropic|baidu|...          │  │
│  │  stream()  SSE 流式解析 + 工具调用循环 + 动画渲染       │  │
│  └───────────────────────┬───────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────▼──────────────────────────────────┐
│  Next.js 服务端 (app/api)  [Edge Runtime]                    │
│  /api/[provider] 统一路由 → 各 provider handler → 上游转发   │
│  /api/config 下发非敏感配置  /api/auth 鉴权(code/APIKey)     │
│  /api/webdav /api/upstash 云同步代理  /api/artifacts KV 存储 │
└──────────────────────────┬──────────────────────────────────┘
                           │ 直接转发
┌──────────────────────────▼──────────────────────────────────┐
│  上游 LLM 提供商 (OpenAI/Azure/Gemini/Claude/文心/豆包/... ) │
└─────────────────────────────────────────────────────────────┘

（Tauri 桌面端：Rust 侧只提供一个 stream_fetch 命令 + 事件桥，
  前端 fetch 被替换为 Tauri 调用，绕过浏览器跨域限制）
```

### 构建模式（双模式）

`app/config/build.ts` 根据 `BUILD_MODE` 产生两种构建：

| 模式 | 说明 | API 走向 |
|------|------|----------|
| `standalone`（默认） | 服务端渲染，含 `/api/*` 代理 | 前端 → 本地 `/api/xx` → 上游 |
| `export`（`BUILD_APP=1`） | 纯静态导出（PWA / Tauri 桌面端） | 前端 → 直接请求上游 `BASE_URL`（借助 Tauri 的 HTTP 能力绕过 CORS） |

`getClientConfig()` 在客户端读取 `<meta name="config">`（由 `app/layout.tsx` 注入），在服务端直接调用 `getBuildConfig()`；`getServerSideConfig()` 读取 `process.env`（见 `app/config/server.ts`）。

---

## 2. 目录结构

```
app/
├── page.tsx / layout.tsx        # 根入口 & 根布局（注入 meta config、ServiceWorker、MCP 初始化）
├── constant.ts                  # 全局常量：路由、ApiPath、ServiceProvider、模型表、模板
├── typing.ts / global.d.ts      # 公共类型 & 静态资源/TAURI 全局声明
├── polyfill.ts                  # Array.prototype.at 垫片
├── utils.ts                     # 工具桶：剪贴板/下载/消息内容提取/TAURI fetch 适配等
├── command.ts                   # URL 命令（:fill :submit :mask 等）与聊天命令
├── config/                      # 构建/客户端/服务端配置
│   ├── build.ts                 #   构建时配置（版本、commit、buildMode、isApp）
│   ├── client.ts                #   客户端配置（读 meta 标签）
│   └── server.ts                #   服务端 env 配置（所有提供商密钥、CODE、CUSTOM_MODELS）
├── store/                       # Zustand store（见 §3）
│   ├── chat.ts access.ts config.ts mask.ts prompt.ts
│   ├── plugin.ts sync.ts update.ts sd.ts index.ts
├── client/                      # 客户端 LLM API 抽象（见 §4）
│   ├── api.ts                   #   LLMApi 抽象类 + ClientApi 工厂 + getHeaders
│   ├── controller.ts            #   流式请求控制器池（停止/重试）
│   └── platforms/               #   每个提供商一个实现（openai/google/anthropic/baidu/...）
├── api/                         # Next.js Route Handlers（Edge runtime）（见 §5）
│   ├── [provider]/[...path]/route.ts   # 统一路由分发
│   ├── openai.ts azure.ts google.ts anthropic.ts baidu.ts bytedance.ts
│   ├── alibaba.ts moonshot.ts iflytek.ts glm.ts xai.ts stability.ts
│   ├── tencent/route.ts         #   腾讯云签名鉴权（HMAC）
│   ├── auth.ts                  #   访问码 / APIKey 鉴权 + 注入系统密钥
│   ├── common.ts                #   OpenAI 系统一代理（含 Azure 适配、模型过滤）
│   ├── config/route.ts          #   下发非敏感服务端配置
│   ├── proxy/route.ts           #   通用代理（插件用）
│   ├── webdav/[...path]/route.ts#   云同步 WebDAV 代理（白名单校验）
│   ├── upstash/[action]/[...key]/route.ts  # Upstash 同步代理
│   ├── artifacts/route.ts       #   Artifacts 分享（Cloudflare KV）
│   └── model-test/route.ts      #   模型可用性批量测试
├── mcp/                         # MCP（Model Context Protocol）集成（见 §7）
│   ├── actions.ts               #   "use server" 服务端动作：初始化/添加/暂停/执行
│   ├── client.ts                #   SDK 客户端封装（stdio transport）
│   ├── types.ts utils.ts logger.ts
├── components/                  # UI 组件（见 §6）
│   ├── home.tsx                 #   路由骨架、主题、懒加载各页面
│   ├── chat.tsx                 #   聊天主界面（~2600 行）
│   ├── settings.tsx mask.tsx plugin.tsx sidebar.tsx markdown.tsx
│   ├── exporter.tsx artifacts.tsx image-editor.tsx message-selector.tsx
│   ├── model-selector-modal.tsx model-config.tsx model-test-button.tsx
│   ├── realtime-chat/           #   实时语音对话（rt-client + AudioWorklet）
│   ├── sd/                      #   Stable Diffusion 绘画
│   ├── voice-print/             #   语音频谱可视化（Canvas）
│   ├── ui-lib.tsx button.tsx emoji.tsx error.tsx input-range.tsx
│   └── mcp-market.tsx           #   MCP 服务器市场
├── utils/                       # 工具函数（见 §8）
│   ├── store.ts                 #   createPersistStore（持久化 store 工厂）
│   ├── chat.ts                  #   SSE 流式请求 + 工具循环 + 图片处理
│   ├── stream.ts                #   Tauri 流式 fetch 桥
│   ├── sync.ts                  #   多 store 合并（导出/导入/云同步）
│   ├── indexedDB-storage.ts     #   IndexedDB 存储适配器
│   ├── file.ts                  #   文件解析（docx/pdf/pptx/xlsx/zip/图片）
│   ├── ms_edge_tts.ts           #   Edge TTS（WebSocket 合成语音）
│   ├── audio.ts lib/audio.ts    #   TTS 播放器 / AudioWorklet 实时音频处理
│   ├── hmac.ts tencent.ts baidu.ts  #   签名算法（腾讯云 TC3-HMAC-SHA256、百度 OAuth）
│   ├── cloudflare.ts            #   AI Gateway URL 重写
│   ├── model.ts model-test.ts token.ts   # 模型收集/测试/Token 估算
│   └── cloud/                   #   webdav.ts upstash.ts 云同步客户端
├── masks/                       # 预设面具（build.ts 构建 public/masks.json）
├── locales/                     # i18n（cn / en，缺失字段回退合并）
├── icons/  styles/  lib/
└── global.d.ts

src-tauri/                       # Tauri 桌面壳
├── src/main.rs                  # invoke_handler 注册 stream_fetch + 窗口状态插件
├── src/stream.rs                # stream_fetch 命令：reqwest 请求并把响应分块 emit 给前端
└── tauri.conf.json              # 窗口/权限/更新器/打包配置

public/                          # 静态资源：masks.json plugins.json prompts.json，
                                 # serviceWorker.js（图片缓存上传）、mcp.json/mcp_cn.json
scripts/                         # fetch-prompts.mjs / setup.sh / init-proxy.sh
test/                            # Jest 单测
```

---

## 3. Store 层（Zustand 全局状态）

所有 store 都通过 `app/utils/store.ts` 的 `createPersistStore` 创建，它组合了
`zustand` 的 `combine` + `persist`，并注入：

- `update(updater)`：深拷贝 state → 修改 → 整体 set（并刷新 `lastUpdateTime`）
- `markUpdate()` / `lastUpdateTime`：供云同步按时间戳合并
- `_hasHydrated`：水合完成标记（`onRehydrateStorage` 中置位），UI 据此决定是否显示 Loading
- 存储后端：`indexedDBStorage`（IndexedDB 优先，localStorage 降级）

| Store | 持久化 key | 职责 |
|-------|-----------|------|
| `useChatStore` | `chat-next-web-store` | 会话列表、消息流、输入模板填充、上下文组装、自动标题、长短期记忆压缩、MCP 缓存 |
| `useAppConfig` | `app-config` | 全局配置：主题、模型表、ModelConfig、TTS/Realtime 配置、功能开关 |
| `useAccessStore` | `access-control` | 各提供商 URL/APIKey、访问码、useCustomConfig、服务端下发的 DangerConfig |
| `useMaskStore` | `mask-store` | 面具（预设人设/上下文/模型参数）CRUD + 内置面具 |
| `usePromptStore` | `prompt-store` | 提示词库（内置 + 用户，Fuse.js 搜索） |
| `usePluginStore` | `chat-next-web-plugin` | 插件（OpenAPI 定义）CRUD，`FunctionToolService` 编译为 tools/funcs |
| `useSyncStore` | `sync` | WebDAV/Upstash 云同步配置与操作 |
| `useUpdateStore` | `chat-update` | 版本检查、用量查询 |
| `useSdStore` | `sd-list` | Stable Diffusion 绘画任务列表 |

### 3.1 聊天核心流（`useChatStore`）

`onUserInput(content, images, isMcpResponse)` 是主入口：

1. **模板填充**：`fillTemplateWith` 把 `{{input}}/{{time}}/{{model}}/{{ServiceProvider}}/{{cutoff}}/{{lang}}` 替换（`DEFAULT_INPUT_TEMPLATE` / `DEFAULT_SYSTEM_TEMPLATE`）。
2. **构造消息**：user 消息 + 一条 `streaming: true` 的空 assistant 消息，立即写入会话。
3. **组装上下文**：`getMessagesWithMemory()` 按 4 段拼接：
   `systemPrompts（OpenAI 系系统提示 + MCP 工具提示）→ 长时记忆 → 面具 context → 最近 N 条消息`，
   并按 `max_tokens` 阈值、`clearContextIndex` 截断。
4. **发起请求**：`getClientApi(providerName).llm.chat({...})`，通过回调把流式增量写入 botMessage
   （`onUpdate`/`onFinish`/`onError`/`onBeforeTool`/`onAfterTool`/`onController`）。
5. **收尾**：`onNewMessage` → 更新统计、检查 MCP JSON、`summarizeSession`（自动标题 + 长时记忆压缩）。

`ChatControllerPool`（`app/client/controller.ts`）以 `sessionId,messageId` 为 key 收集
`AbortController`，实现"停止生成 / 重试"。

### 3.2 状态合并与云同步（`app/utils/sync.ts`）

- `getLocalAppState()` 用各 store 的 getter 收集"非函数字段"；
- `mergeAppState(local, remote)` 按 store 类型使用不同合并策略：
  - Chat：按 sessionId 合并、按消息 id 去重、按日期排序；
  - Mask/Prompt：`{...remote, ...local}` 本地优先；
  - Config/Access：按 `lastUpdateTime` 时间戳取新。
- 导出/导入为单个 JSON 文件；云同步通过 WebDAV / Upstash 客户端（见 §5.4）。

---

## 4. 客户端 API 层（`app/client`）

### 4.1 抽象：`LLMApi`

```ts
abstract class LLMApi {
  abstract chat(options: ChatOptions): Promise<void>;
  abstract speech(options: SpeechOptions): Promise<ArrayBuffer>;
  abstract usage(): Promise<LLMUsage>;
  abstract models(): Promise<LLMModel[]>;
}
```

`ClientApi`（`api.ts`）是工厂：按 `ModelProvider` 选择具体实现（`ChatGPTApi` / `GeminiProApi` /
`ClaudeApi` / `ErnieApi` / `DoubaoApi` / `QwenApi` / `HunyuanApi` / `MoonshotApi` / `SparkApi` /
`XAIApi` / `ChatGLMApi`）。`getHeaders()` 根据当前 provider 选择鉴权头
（`Authorization` / `api-key` / `x-api-key` / `x-goog-api-key`），并支持访问码 `nk-` 前缀。

### 4.2 地址解析

每个平台实现有自己的 `path()` 逻辑：优先读取 `useAccessStore` 的 `useCustomConfig` 自定义
URL；否则 Web 模式走 `/api/xxx` 本地代理，App（export）模式直接走 `BASE_URL` 常量；
最后统一经过 `cloudflareAIGatewayUrl()` 做 AI Gateway URL 重写（可选）。

### 4.3 流式请求与工具循环（`app/utils/chat.ts` 的 `stream()`）

1. 用 `@fortaine/fetch-event-source` 发起 SSE POST（`fetch` 在 App 端被替换为 Tauri 桥）。
2. `parseSSE` 由各平台提供（OpenAI 解析 `delta.content` / `tool_calls` / `reasoning_content`；
   Gemini 解析 `candidates`；Claude 解析 `content_block_delta` 等）。
3. **打字机动画**：`animateResponseText` 用 `requestAnimationFrame` 把累积文本按帧吐出，
   让 `onUpdate` 平滑刷新 UI。
4. **工具调用循环**：收到 `tool_calls` → 收集到 `runTools` → 流结束后并行执行本地函数
   （插件 `funcs[tool.function.name]`）→ `onAfterTool` 记录结果 → 把 `tool` 消息追加进
   `requestPayload` 重新发起请求（最多循环直到不再产生工具调用）。
5. 错误处理：非 200 / 非 SSE 响应 → 收集 body 文本或 JSON 展示给用户；`REQUEST_TIMEOUT_MS` 超时 abort。

---

## 5. 服务端 API 层（`app/api`）

全部 Route Handler 运行在 **Edge Runtime**（`export const runtime = "edge"`），并声明
`preferredRegion` 多区域。核心链路：

### 5.1 统一路由分发

`/api/[provider]/[...path]/route.ts` 按 `params.provider` 分发到各 handler
（OpenAI/Azure/Google/Anthropic/Baidu/ByteDance/Alibaba/Moonshot/Stability/Iflytek/XAI/ChatGLM），
未知 provider 走 `proxyHandler`。`next.config.mjs` 还配置了 `/api/proxy/*` 的
`rewrites`（OpenAI/Google/Anthropic/Azure/Alibaba 直连上游）。

### 5.2 鉴权（`auth.ts`）

每个 handler 先调用 `auth(req, ModelProvider.XXX)`：

- 解析 `Authorization`：`nk-` 前缀 → 访问码（`md5` 后与 `CODE` 环境变量哈希集合比对）；
  否则视为用户自带 API Key。
- `hideUserApiKey` 时拒绝用户 Key；未提供 Key 时注入服务端配置的系统 Key
  （按 provider 从 `getServerSideConfig()` 取）。

### 5.3 OpenAI 系统一代理（`common.ts` `requestOpenai`）

- 识别 Azure 路径（`azure/deployments`），切换 `api-key` 头与 `AZURE_URL`；
- 支持 `CUSTOM_MODELS` 过滤（`isModelAvailableInServer` 拒绝禁用模型，如 `DISABLE_GPT4`）；
- 10 分钟超时 abort；清理 `content-encoding` 等响应头以兼容 Vercel gzip；
- 其余提供商 handler（google/anthropic/baidu/bytedance/...）把请求体转换成各自协议后转发。

### 5.4 云同步代理

- `webdav/[...path]/route.ts`：把请求转发到用户配置的 WebDAV 端点，但先校验
  host 在内置白名单 + `WHITE_WEBDAV_ENDPOINTS` 内；
- `upstash/[action]/[...key]/route.ts`：仅允许 `*.upstash.io` 的 get/set；
- 客户端实现见 `app/utils/cloud/{webdav,upstash}.ts`（大状态自动切片）。

### 5.5 其它端点

- `config/route.ts`：下发 `DANGER_CONFIG`（needCode/hideUserApiKey/customModels/defaultModel 等，**不含密钥明文**）；
- `artifacts/route.ts`：Artifacts 分享 → Cloudflare KV（按内容 md5 作 key + TTL）；
- `model-test/route.ts`：批量测试模型可用性（并发 + 5s 超时）；
- `proxy/route.ts`：插件通用转发（用服务端 OPENAI_API_KEY，仅 GET JSON）。

---

## 6. UI 层（`app/components`）

- **路由骨架**：`home.tsx` 用 `react-router-dom` 的 `HashRouter`，页面全部 `next/dynamic` 懒加载：`/`(Chat)、`/settings`、`/masks`、`/new-chat`、`/plugins`、`/sd`、`/search-chat`、`/mcp-market`、`/artifacts/:id`、`/auth`。`useLoadData()` 启动时拉取模型列表并 `mergeModels`。
- **聊天主界面** `chat.tsx`：消息列表（分页渲染 `CHAT_PAGE_SIZE`）、输入框（自动增高）、
  Prompt 提示、附件上传、图片编辑器、TTS 朗读、Realtime 语音入口、会话配置弹窗、导出分享、快捷键。
- **Markdown 渲染** `markdown.tsx`：react-markdown + remark-gfm/math + rehype-katex/highlight/raw，
  支持 Mermaid 图、代码折叠、`<thinking>` 内容折叠、Artifacts 内嵌预览。
- **Artifacts**：HTML 预览沙箱（iframe srcdoc），可全屏/分享/下载。
- **SD 绘画** `sd/`：参数面板（模型版本/提示词/负向提示/尺寸/CFG/步数等）→
  `useSdStore.stabilityRequestCall` → `/api/stability`（或直连）→ 结果上传到图片缓存。
- **Realtime 语音** `realtime-chat/`：基于微软 `rt-client`（Azure 实时音频 SDK）建立
  WebSocket 会话；`app/lib/audio.ts` 的 `AudioHandler` 用 AudioWorklet 录制/播放 24kHz
  PCM 并做频谱分析；`voice-print/` 在 Canvas 上绘制实时频谱。
- **TTS**：OpenAI TTS（`llm.speech()`）或 Edge TTS（`ms_edge_tts.ts`，WebSocket 拉取
  audio/mp3 流），`app/utils/audio.ts` 的 `createTTSPlayer` 播放。
- **通用 UI**：`ui-lib.tsx`（Modal/List/Toast/Selector…）、`button.tsx`、`emoji.tsx`。

---

## 7. 插件与 MCP

### 7.1 插件（OpenAPI → function calling）

`usePluginStore` 的 `FunctionToolService.add(plugin)`：

1. 用 `js-yaml` 解析插件 OpenAPI 定义；
2. `openapi-client-axios` 生成 API client，`getOperations()` 得到每个操作；
3. 把操作编译为 OpenAI 格式的 `tools`（function schema）与可调用的 `funcs`（返回 Promise）；
4. 鉴权注入：`authType`（bearer/basic/custom）× `authLocation`（header/query/body）；
5. Web 模式经 `/api/proxy` 转发（`X-Base-URL` 指定目标），App 模式直连服务端 URL；
6. 内置插件从 `public/plugins.json` 拉取。

chat 发起请求时 `getAsTools(session.mask.plugin)` 取当前面具启用的插件，
tools 随请求体发送，工具调用结果循环回填（见 §4.3）。

### 7.2 MCP（Model Context Protocol）

- **架构**：`app/mcp/actions.ts` 标 `"use server"`，运行在 Next.js 服务端（Node 环境），
  用官方 SDK 的 `StdioClientTransport` 拉起本地 MCP server 子进程（配置保存在运行时生成的
  `app/mcp/mcp_config.json`，初始模板为 `mcp_config.default.json`，含 `status: active/paused/error`）。
- **生命周期**：`initializeMcpSystem()` 启动时连接所有 active server 并 `listTools`；
  `addMcpServer` / `pauseMcpServer` / `resumeMcpServer` / `removeMcpServer` / `restartAllClients`
  管理配置与连接；`getClientsStatus()` 供前端展示状态。
- **调用方式（非原生 function calling）**：NeatChat 采用"文本协议"——把工具清单注入
  系统提示词（`MCP_SYSTEM_TEMPLATE`），模型用 Markdown 代码块输出
  ```` ```json:mcp:{clientId} ``` ```` 形式的调用；`useChatStore.checkMcpJson` 解析该
  代码块 → `executeMcpAction` → 把结果以 ````
  ```json:mcp-response:{clientId} ``` ```` 用户消息回灌给模型继续对话。
- **MCP 市场**：`mcp-market.tsx` 从 `public/mcp.json`（八爪鱼/文件系统等预设 server）一键安装。

---

## 8. 工具与基础设施（`app/utils`）

| 模块 | 职责 |
|------|------|
| `store.ts` | `createPersistStore` 持久化 store 工厂（见 §3） |
| `indexedDB-storage.ts` | IndexedDB + localStorage 双通道存储适配器 |
| `chat.ts` | SSE 流、图片压缩/缓存/上传、base64 转换 |
| `stream.ts` | Tauri `stream_fetch` 桥：`invoke` 发起请求，`listen("stream-response")` 收块，组装成 Web `Response` |
| `sync.ts` | 多 store 快照/合并/云同步 |
| `file.ts` | docx(mammoth)/pdf(pdfjs)/pptx/zip(xlsx 等)/图片 解析提取文本 |
| `model.ts` | 模型表收集/排序/自定义模型解析（`model@provider` 语法） |
| `model-test.ts` | 前端模型连通性测试 |
| `token.ts` | 轻量 token 估算（无 tiktoken，按字符加权） |
| `hmac.ts` | 纯 JS SHA-256/HMAC-SHA256（腾讯云签名用） |
| `tencent.ts` | 腾讯云 TC3-HMAC-SHA256 请求头生成 |
| `baidu.ts` | 百度千帆 OAuth access_token |
| `cloudflare.ts` | Cloudflare AI Gateway URL 重写 |
| `ms_edge_tts.ts` | Edge 神经网络 TTS（WebSocket） |
| `audio.ts` / `lib/audio.ts` | TTS 播放器 / Realtime AudioWorklet 引擎 |
| `cloud/` | WebDAV、Upstash 同步客户端（含分块上传） |
| `object.ts clone.ts merge.ts format.ts` | 通用工具（omit/pick/deepClone/merge/chunks/prettyObject） |

### 8.1 双端 fetch 适配（关键设计）

`app/utils.ts` 的 `fetch()` 与 `app/utils/stream.ts` 的 `fetch()`（Tauri 版）：

- Web 端：直接 `window.fetch`；
- Tauri 端：`window.__TAURI__.invoke("stream_fetch", {url, method, headers, body})`
  → Rust `src/stream.rs` 用 `reqwest` 发起请求（允许任意 https CORS），
  并把响应体以 `ChunkPayload` 事件逐块 `window.emit("stream-response", ...)` 推回前端；
  前端监听事件，把字节写入 `TransformStream`，构造一个标准的 `Response` 对象，
  从而上层 `fetchEventSource` 无需改动即可解析 SSE。

这正是桌面端能直连 OpenAI 等上游且无需本地代理的关键。

### 8.2 图片缓存（ServiceWorker）

`public/serviceWorker.js` 拦截 `/api/cache/*`：POST 上传 → 写入 CacheStorage 并返回
`/api/cache/{nanoid}.{ext}` URL；GET 命中缓存；DELETE 删除。DALL·E 3 / SD 生成的图片与
用户上传的附件都经此存储，规避服务器磁盘与各平台存储差异。

---

## 9. 桌面端（Tauri）——已移除

> 自 v1.2.0 起，桌面端（Tauri）及内置更新器（updater pubkey 签名校验）已移除，
> 仅保留 Linux Docker + Web 访问（见 §14 演进计划）。原 `src-tauri/` 目录、
> `app/utils/stream.ts`（stream_fetch 桥）、`window.__TAURI__` 相关代码均已删除。

---

## 10. 配置与环境变量

### 10.1 服务端（`app/config/server.ts`，Docker/Vercel 部署）

`OPENAI_API_KEY`（支持逗号分隔轮询）、`CODE`（访问码，md5 后比较）、`BASE_URL`、
`AZURE_URL/_API_KEY`、`GOOGLE_API_KEY`、`ANTHROPIC_API_KEY`、`BAIDU_API_KEY/_SECRET_KEY`、
`BYTEDANCE_API_KEY`、`ALIBABA_API_KEY`、`TENCENT_SECRET_ID/_KEY`、`MOONSHOT_API_KEY`、
`IFLYTEK_API_KEY/_SECRET`、`XAI_API_KEY`、`CHATGLM_API_KEY`、`STABILITY_API_KEY`、
`CUSTOM_MODELS`、`DEFAULT_MODEL`、`DISABLE_GPT4`、`HIDE_USER_API_KEY`、
`ENABLE_BALANCE_QUERY`、`DISABLE_FAST_LINK`、`WHITE_WEBDAV_ENDPOINTS`、
`ENABLE_MCP`、`CLOUDFLARE_*`（KV）、`PROXY_URL`（Docker proxychains）等。

### 10.2 构建时（`app/config/build.ts`）

`BUILD_MODE=standalone|export`、`BUILD_APP=1`（桌面端）、`DISABLE_CHUNK`。

### 10.3 客户端（`app/store/access.ts` + `app/store/config.ts`）

各提供商 URL/Key、`useCustomConfig`、访问码；全局配置（主题、模型、ModelConfig 温度等参数、
TTS/Realtime 配置、功能开关）。`collectModels` 支持 `customModels` 追加/隐藏
（`-model` 前缀隐藏）。

---

## 11. 数据流全景（一次对话请求）

```
用户输入 → Chat 组件 → useChatStore.onUserInput
  → fillTemplateWith（模板填充）
  → 组装上下文 getMessagesWithMemory（系统提示 + 记忆 + context + 最近消息）
  → getClientApi(provider).llm.chat({...})
      → 平台实现（如 ChatGPTApi.chat）
          → path() 解析：/api/openai（Web）或 api.openai.com（App/Tauri）
          → stream() → fetchEventSource（Tauri 桥 or window.fetch）
              → Next.js /api/[provider] 路由 → auth() 鉴权 → 上游转发
              → SSE 流式返回 → parseSSE → 打字机动画 onUpdate → UI 增量渲染
              → 若含 tool_calls → 本地执行插件/MCP → 回填后重新请求
  → onFinish → onNewMessage → 统计 + 标题生成 + 记忆压缩
  → useChatStore update() → IndexedDB 持久化
```

---

## 12. 测试与工程化

- **测试**：Jest + Testing Library（`jest.config.ts`，jsdom 环境），现有
  `test/model-provider.test.ts`（`getModelProvider` 解析）、`test/sum-module.test.ts`；
  `yarn test:ci` 用于 CI。
- **Lint/格式化**：ESLint + Prettier + husky + lint-staged。
- **i18n**：`app/locales/`（cn/en），`merge(fallback, target)` 保证缺字段回退。
- **CI/CD**：`.github/workflows/docker.yml` 构建 Docker 镜像；
  `Dockerfile` 为 standalone 输出 + proxychains 代理支持；Vercel 直接部署。

---

## 13. 关键设计决策与扩展点

1. **双构建模式**是"一套代码三端（Web/Serverless/桌面）"的基础：Web 用服务端代理隐藏密钥，
   桌面/PWA 用 Tauri 网络能力直连。
2. **Provider 插件化**：新增模型提供商 = 在 `constant.ts` 加模型表 + `app/client/platforms/`
   加一个实现 + `app/api/` 加一个 handler（或复用 openai 兼容协议）+ `access.ts` 加配置项，
   其余（UI、记忆、插件、导出）全部复用。
3. **流式工具循环**与"文本协议"的 MCP 是本项目最独特的扩展点；插件体系（OpenAPI→function
   calling）让第三方 API 无需写代码即可成为模型工具。
4. **本地优先 + 云同步**：所有数据落 IndexedDB，导出/WebDAV/Upstash 同步以 JSON 快照合并，
   无服务端账号体系。
5. **安全边界**：服务端只下发非敏感配置（`/api/config`）；访问码 md5 存储比对；
   WebDAV/Upstash 代理有 host 白名单；密钥永不进入客户端构建产物。

---

## 14. 演进计划：收敛为「Linux Docker + Web 访问」单一部署方式

> 目标：移除桌面端（Tauri）、PWA 静态导出、Vercel 等其它使用/部署方式，
> 仅保留「Linux 上运行 Docker 镜像（`limour/next-chat`）+ 浏览器访问」这一种方式，
> 降低代码复杂度与维护成本。镜像由 `.github/workflows/docker.yml` 在
> `release` 发布或手动触发（`workflow_dispatch`）时构建并推送到 Docker Hub。

### 14.1 现状（待移除项）

| 使用方式 | 载体 | 核心代码/配置 | 状态 |
|---------|------|--------------|------|
| Web（standalone + Docker） | Next.js SSR + `/api/*` 代理 | `app/api`、`Dockerfile`、`docker-compose.yml` | ✅ 保留（唯一目标） |
| 桌面端（Tauri） | Rust 壳 + 静态导出 | `src-tauri/`、`app/utils/stream.ts`、`BUILD_APP=1`、`app:build` | ✅ 已移除（v1.2.0） |
| PWA / 静态导出 | `BUILD_MODE=export` | `app/config/build.ts`、`next.config.mjs`（`output: export`） | ❌ 待移除 |
| Vercel 部署 | Serverless | README 按钮、`vercel.json` | ❌ 待移除（可选） |

### 14.1.1 模型平台收敛（已完成）

> 仅保留 OpenAI 平台，移除所有其它模型提供商（含 Azure）：

- [x] 删除 `app/client/platforms/` 下除 `openai.ts` 外的全部实现（google/anthropic/baidu/bytedance/alibaba/tencent/moonshot/iflytek/xai/glm）
- [x] 删除 `app/api/` 下除 `openai.ts`/`common.ts`/`auth.ts`/`proxy.ts` 外的全部 handler（含 `azure.ts`、`stability.ts`、`tencent/`）
- [x] `app/constant.ts`：`ServiceProvider` 仅留 `OpenAI`，`ModelProvider` 仅留 `GPT`，模型表仅保留 OpenAI 模型，删除各平台常量与 `ApiPath` 条目
- [x] `app/store/access.ts`：仅保留 OpenAI URL/Key 配置，删除各平台 `isValidXxx` 与字段
- [x] `app/config/server.ts`：仅保留 OpenAI 相关环境变量与返回字段
- [x] `app/client/api.ts`：`ClientApi`/`getClientApi`/`getHeaders` 仅走 OpenAI
- [x] `app/api/[provider]` 路由：仅分发 `openai` 与 `proxy`
- [x] `next.config.mjs`：删除 azure/google/anthropic/alibaba 的 rewrites
- [x] 移除 Stable Diffusion（SD）绘画功能（唯一提供商 Stability 已移除）：删除 `app/store/sd.ts`、`app/components/sd/`、`Path.Sd/SdNew`、emoji/locales 相关条目
- [x] `app/api/common.ts`：删除 Azure 分支（`azureUrl`/`azureApiVersion`/deployment 重写）
- [x] 清理 `app/components/settings.tsx`、`auth.tsx`、`realtime-*`、`model-config.tsx`、`emoji.tsx`、locales 中的平台 UI/文案
- [x] 删除无引用的 `app/utils/baidu.ts`、`app/utils/tencent.ts`、`app/utils/hmac.ts`

> 注：`CUSTOM_MODELS` 的 `@类别` 自定义模型仍可用（OpenAI 兼容通道，如 `+gpt-4o-mini@Deepbricks`）。
### 14.2 移除步骤

**Phase 1：移除 Tauri 桌面端** ✅ 已完成

- [x] 删除 `src-tauri/` 目录（`main.rs` / `stream.rs` / `tauri.conf.json` / `Cargo.*` / `icons/`）
- [x] `package.json`：删除 `@tauri-apps/api`、`@tauri-apps/cli` 依赖；删除 `app:dev`、`app:build` 脚本
- [x] 删除 `app/utils/stream.ts`（Tauri `stream_fetch` 桥），`app/utils/chat.ts` 恢复直接使用全局 `fetch`
- [x] 删除 `app/global.d.ts` 中 `__TAURI__` 类型声明；清理 `app/store/update.ts`、`app/store/plugin.ts`、`app/utils.ts`、`app/components/exporter.tsx` 中的 `window.__TAURI__` 分支
- [x] 移除 Tauri 更新器（updater pubkey 签名校验）与 `clientUpdate()`；`app/config/build.ts` 版本号改为硬编码
- [ ] `app/config/build.ts`：移除 `BUILD_APP=1` / `isApp` 逻辑（**挂起**：`isApp` 仍被 export/PWA 模式使用，待 Phase 2 一并移除）

**Phase 2：移除 export 静态构建（PWA）**

- [ ] `package.json`：删除 `export`、`export:dev`、`app:dev` 脚本，仅保留 `build`（standalone）
- [ ] `app/config/build.ts`：`BUILD_MODE` 固定为 `standalone`，删除 export 分支
- [ ] `app/store/access.ts` 及各 `app/client/platforms/*.ts`：删除 `isApp` 三目分支，URL 一律走本地 `/api/xx` 代理
- [ ] `app/locales/{cn,en}.ts`、`app/store/sync.ts`、`app/store/config.ts`、`app/store/update.ts`：删除 `isApp` 相关分支
- [ ] `next.config.mjs`：移除 `output: export`、`images.unoptimized`、`LimitChunkCountPlugin`（DISABLE_CHUNK）等 export-only 配置

**Phase 3：移除 Vercel 部署（可选）**

- [ ] 删除 `vercel.json`；README 移除 Vercel 按钮与说明
- [ ] 评估 `@vercel/analytics` / `@vercel/speed-insights` 依赖的去留

**Phase 4：文档与 CI 收敛**

- [ ] `ARCHITECTURE.md`：删除 §1 双模式/Tauri 描述、§8.1 双端 fetch 适配、§9 桌面端章节，统一为「Docker standalone + Web」
- [ ] README：移除 Windows / macOS / PWA 徽章与 Vercel 一段，仅保留 Docker 启动说明
- [ ] `.github/workflows/docker.yml` 保持不变（已是唯一发布通道）

### 14.3 目标架构（收敛后）

```
    Linux 主机
  ┌───────────────────────────────┐
  │  Docker (limour/next-chat)    │
  │  ┌─────────────────────────┐  │
  │  │ Next.js standalone      │  │
  │  │  UI (app/components)    │  │
  │  │  Store (app/store)      │  │
  │  │  Client API (app/client)│  │
  │  │  /api/* 代理 → 上游 LLM │  │
  │  └───────────┬─────────────┘  │
  │              │ :3000          │
  └──────────────┼────────────────┘
                 │ HTTP
        ┌────────▼────────┐
        │  浏览器 (Web)    │
        └─────────────────┘
```

### 14.4 验收标准

- [ ] `docker compose up -d` 后浏览器可直接访问并使用（参考 README 示例）
- [ ] `yarn build`（standalone）为唯一构建路径，`yarn export` / `tauri build` 不复存在
- [ ] 代码库中不再出现 `__TAURI__`、`BUILD_APP`、`src-tauri` 等痕迹
- [ ] `.github/workflows/docker.yml` 为唯一发布通道，镜像推送 `limour/next-chat`