# NeatChat 架构文档

> 本文档深入分析 NeatChat 的代码架构。NeatChat 是基于
> [ChatGPT-Next-Web (NextChat)](https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web)
> 深度重构的 AI 对话客户端，当前仅支持「Linux 下 Docker 启动 + Web 访问」单一方式。
> 已移除功能：桌面端（Tauri）、PWA 静态导出、Vercel 部署、多模型平台（仅留 OpenAI）、
> 语音（TTS / 实时语音）、文件上传（Word/PDF/PPT/ZIP）、云同步（WebDAV / Upstash）、
> MCP（Model Context Protocol）工具调用、插件（OpenAPI 转 function calling）。

- 技术栈：Next.js 14 (App Router) + React 18 + TypeScript + Zustand
- 状态管理：Zustand（`create` + `persist` 中间件）
- 数据持久化：IndexedDB（`idb-keyval`，localStorage 兜底）
- 多模态输入：文本、图片（含压缩/上传）
- 功能亮点：OpenAI 模型、Artifacts

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        浏览器 (Web)                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  UI 层 (app/components)                               │  │
│  │  chat / settings / mask / artifacts / search               │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ zustand hooks                   │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │  Store 层 (app/store)  纯前端全局状态                   │  │
│  │  chat / config / access / mask / prompt / update             │  │
│  │                          持久化→IndexedDB/localStorage │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ ClientApi (LLMApi 抽象)          │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │  客户端 API 层 (app/client)                            │  │
│  │  platforms/openai                                 │  │
│  │  stream()  SSE 流式解析 + 工具调用循环 + 动画渲染       │  │
│  └───────────────────────┬───────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────▼──────────────────────────────────┐
│  Next.js 服务端 (app/api)  [Edge Runtime]                    │
│  /api/[provider] 统一路由 → 各 provider handler → 上游转发   │
│  /api/config 下发非敏感配置  /api/auth 鉴权(code/APIKey)     │
│  /api/artifacts KV 存储                                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ 直接转发
┌──────────────────────────▼──────────────────────────────────┐
│  上游 LLM 提供商 (OpenAI / OpenAI 兼容网关 / 聚合站) │
└─────────────────────────────────────────────────────────────┘

```
### 构建模式

采用单一构建模式：`standalone`（`next.config.mjs` 固定 `output: "standalone"`），
服务端渲染并包含 `/api/*` 代理：前端 → 本地 `/api/xx` → 上游。

`getClientConfig()` 在客户端读取 `<meta name="config">`（由 `app/layout.tsx` 注入），在服务端直接调用 `getBuildConfig()`；`getServerSideConfig()` 读取 `process.env`（见 `app/config/server.ts`）。
---

## 2. 目录结构

```
app/
├── page.tsx / layout.tsx        # 根入口 & 根布局（注入 meta config、ServiceWorker）
├── constant.ts                  # 全局常量：路由、ApiPath、ServiceProvider、模型表、模板
├── typing.ts / global.d.ts      # 公共类型 & 静态资源声明
├── polyfill.ts                  # Array.prototype.at 垫片
├── utils.ts                     # 工具桶：剪贴板/下载/消息内容提取等
├── command.ts                   # URL 命令（:fill :submit :mask 等）与聊天命令
├── config/                      # 构建/客户端/服务端配置
│   ├── build.ts                 #   构建时配置（版本、commit）
│   ├── client.ts                #   客户端配置（读 meta 标签）
│   └── server.ts                #   服务端 env 配置（OpenAI 密钥、CODE、CUSTOM_MODELS）
├── store/                       # Zustand store（见 §3）
│   ├── chat.ts access.ts config.ts mask.ts prompt.ts update.ts index.ts
├── client/                      # 客户端 LLM API 抽象（见 §4）
│   ├── api.ts                   #   LLMApi 抽象类 + ClientApi 工厂 + getHeaders
│   ├── controller.ts            #   流式请求控制器池（停止/重试）
│   └── platforms/               #   OpenAI 平台实现
├── api/                         # Next.js Route Handlers（Edge runtime）（见 §5）
│   ├── [provider]/[...path]/route.ts   # 统一路由分发
│   ├── openai.ts common.ts auth.ts proxy.ts
│   ├── auth.ts                  #   访问码 / APIKey 鉴权 + 注入系统密钥
│   ├── common.ts                #   OpenAI 系统一代理（模型过滤）
│   ├── config/route.ts          #   下发非敏感服务端配置
│   ├── proxy/route.ts           #   通用代理
│   ├── artifacts/route.ts       #   Artifacts 分享（Cloudflare KV）
│   └── model-test/route.ts      #   模型可用性批量测试
├── components/                  # UI 组件（见 §6）
│   ├── home.tsx                 #   路由骨架、主题、懒加载各页面
│   ├── chat.tsx                 #   聊天主界面（~2100 行）
│   ├── settings.tsx mask.tsx sidebar.tsx markdown.tsx
│   ├── exporter.tsx artifacts.tsx image-editor.tsx message-selector.tsx
│   ├── model-selector-modal.tsx model-config.tsx model-test-button.tsx
│   ├── ui-lib.tsx button.tsx emoji.tsx error.tsx input-range.tsx
├── utils/                       # 工具函数（见 §7）
│   ├── store.ts                 #   createPersistStore（持久化 store 工厂）
│   ├── chat.ts                  #   SSE 流式请求 + 工具循环 + 图片处理
│   ├── sync.ts                  #   多 store 合并（导出/导入）
│   ├── indexedDB-storage.ts     #   IndexedDB 存储适配器
│   ├── cloudflare.ts            #   AI Gateway URL 重写
│   ├── model.ts model-test.ts token.ts   # 模型收集/测试/Token 估算
├── masks/                       # 预设面具（build.ts 构建 public/masks.json）
├── locales/                     # i18n（cn / en，缺失字段回退合并）
├── icons/  styles/  lib/
└── global.d.ts


public/                          # 静态资源：masks.json prompts.json，
                                 # serviceWorker.js（图片缓存上传）
scripts/                         # fetch-prompts.mjs / setup.sh / init-proxy.sh
test/                            # Jest 单测
```

---

## 3. Store 层（Zustand 全局状态）

所有 store 都通过 `app/utils/store.ts` 的 `createPersistStore` 创建，它组合了
`zustand` 的 `combine` + `persist`，并注入：

- `update(updater)`：深拷贝 state → 修改 → 整体 set（并刷新 `lastUpdateTime`）
- `markUpdate()` / `lastUpdateTime`：供导出/导入合并按时间戳取新
- `_hasHydrated`：水合完成标记（`onRehydrateStorage` 中置位），UI 据此决定是否显示 Loading
- 存储后端：`indexedDBStorage`（IndexedDB 优先，localStorage 降级）

| Store | 持久化 key | 职责 |
|-------|-----------|------|
| `useChatStore` | `chat-next-web-store` | 会话列表、消息流、输入模板填充、上下文组装、自动标题、长短期记忆压缩 |
| `useAppConfig` | `app-config` | 全局配置：主题、模型表、ModelConfig、功能开关 |
| `useAccessStore` | `access-control` | OpenAI URL/APIKey、访问码、useCustomConfig、服务端下发的 DangerConfig |
| `useMaskStore` | `mask-store` | 面具（预设人设/上下文/模型参数）CRUD + 内置面具 |
| `usePromptStore` | `prompt-store` | 提示词库（内置 + 用户，Fuse.js 搜索） |
| `useUpdateStore` | `chat-update` | 版本检查、用量查询 |
| `useSyncStore` | `sync` | 状态导出/导入（本地 JSON 备份） |
### 3.1 聊天核心流（`useChatStore`）

`onUserInput(content, images)` 是主入口：

1. **模板填充**：`fillTemplateWith` 把 `{{input}}/{{time}}/{{model}}/{{ServiceProvider}}/{{cutoff}}/{{lang}}` 替换（`DEFAULT_INPUT_TEMPLATE` / `DEFAULT_SYSTEM_TEMPLATE`）。
2. **构造消息**：user 消息 + 一条 `streaming: true` 的空 assistant 消息，立即写入会话。
3. **组装上下文**：`getMessagesWithMemory()` 按 4 段拼接：
   `systemPrompts（OpenAI 系系统提示）→ 长时记忆 → 面具 context → 最近 N 条消息`，
   并按 `max_tokens` 阈值、`clearContextIndex` 截断。
4. **发起请求**：`getClientApi(providerName).llm.chat({...})`，通过回调把流式增量写入 botMessage
   （`onUpdate`/`onFinish`/`onError`/`onBeforeTool`/`onAfterTool`/`onController`）。
5. **收尾**：`onNewMessage` → 更新统计、`summarizeSession`（自动标题 + 长时记忆压缩）。

`ChatControllerPool`（`app/client/controller.ts`）以 `sessionId,messageId` 为 key 收集
`AbortController`，实现"停止生成 / 重试"。

### 3.2 状态合并与导出/导入（app/utils/sync.ts）

- `getLocalAppState()` 用各 store 的 getter 收集"非函数字段"；
- `mergeAppState(local, remote)` 按 store 类型使用不同合并策略：
  - Chat：按 sessionId 合并、按消息 id 去重、按日期排序；
  - Mask/Prompt：`{...remote, ...local}` 本地优先；
  - Config/Access：按 `lastUpdateTime` 时间戳取新。
- 导出/导入为单个 JSON 文件，使用上述合并策略。

---

## 4. 客户端 API 层（`app/client`）

### 4.1 抽象：`LLMApi`

```ts
abstract class LLMApi {
  abstract chat(options: ChatOptions): Promise<void>;
  abstract usage(): Promise<LLMUsage>;
  abstract models(): Promise<LLMModel[]>;
}
```

`ClientApi`（`api.ts`）是工厂：当前仅 OpenAI 平台（`ChatGPTApi`）。`getHeaders()` 生成
`Authorization` 头（用户 API Key 或 `nk-` 访问码前缀）。

### 4.2 地址解析

`path()` 逻辑：优先读取 `useAccessStore` 的 `useCustomConfig` 自定义 URL；
否则走 `/api/openai` 本地代理；最后统一经过 `cloudflareAIGatewayUrl()` 做 AI Gateway URL 重写（可选）。

### 4.3 流式请求与工具循环（`app/utils/chat.ts` 的 `stream()`）

1. 用 `@fortaine/fetch-event-source` 发起 SSE POST。
2. `parseSSE` 解析 OpenAI 格式（`delta.content` / `tool_calls` / `reasoning_content`）。
3. **打字机动画**：`animateResponseText` 用 `requestAnimationFrame` 把累积文本按帧吐出，
   让 `onUpdate` 平滑刷新 UI。
4. **工具调用循环**：收到 `tool_calls` → 收集到 `runTools` → 流结束后执行对应工具
   → `onAfterTool` 记录结果 → 把 `tool` 消息追加进
   `requestPayload` 重新发起请求（最多循环直到不再产生工具调用）。
5. 错误处理：非 200 / 非 SSE 响应 → 收集 body 文本或 JSON 展示给用户；`REQUEST_TIMEOUT_MS` 超时 abort。

---

## 5. 服务端 API 层（`app/api`）

全部 Route Handler 运行在 **Edge Runtime**（`export const runtime = "edge"`），并声明
`preferredRegion` 多区域。核心链路：

### 5.1 统一路由分发

`/api/[provider]/[...path]/route.ts` 按 `params.provider` 分发到各 handler
（OpenAI / proxy），未知 provider 走 `proxyHandler`。`next.config.mjs` 还配置了
`/api/proxy/openai/*` 的 `rewrite`（直连上游）。

### 5.2 鉴权（`auth.ts`）

每个 handler 先调用 `auth(req, ModelProvider.XXX)`：

- 解析 `Authorization`：`nk-` 前缀 → 访问码（`md5` 后与 `CODE` 环境变量哈希集合比对）；
  否则视为用户自带 API Key。
- `hideUserApiKey` 时拒绝用户 Key；未提供 Key 时注入服务端配置的系统 Key
  （按 provider 从 `getServerSideConfig()` 取）。

### 5.3 OpenAI 系统一代理（`common.ts` `requestOpenai`）

- 支持 `CUSTOM_MODELS` 过滤（`isModelAvailableInServer` 拒绝禁用模型，如 `DISABLE_GPT4`）；
- 10 分钟超时 abort；清理 `content-encoding` 等响应头以兼容上游 gzip。

### 5.4 其它端点

- `config/route.ts`：下发 `DANGER_CONFIG`（needCode/hideUserApiKey/customModels/defaultModel 等，**不含密钥明文**）；
- `artifacts/route.ts`：Artifacts 分享 → Cloudflare KV（按内容 md5 作 key + TTL）；
- `model-test/route.ts`：批量测试模型可用性（并发 + 5s 超时）；
- `proxy/route.ts`：通用代理转发（用服务端 OPENAI_API_KEY，仅 GET JSON）。

---

## 6. UI 层（`app/components`）

- **路由骨架**：`home.tsx` 用 `react-router-dom` 的 `HashRouter`，页面全部 `next/dynamic` 懒加载：`/`(Chat)、`/settings`、`/masks`、`/new-chat`、`/search-chat`、`/artifacts/:id`、`/auth`。`useLoadData()` 启动时拉取模型列表并 `mergeModels`。
- **聊天主界面** `chat.tsx`：消息列表（分页渲染 `CHAT_PAGE_SIZE`）、输入框（自动增高）、
  Prompt 提示、附件上传、图片编辑器、会话配置弹窗、导出分享、快捷键。
- **Markdown 渲染** `markdown.tsx`：react-markdown + remark-gfm/math + rehype-katex/highlight/raw，
  支持 Mermaid 图、代码折叠、`<thinking>` 内容折叠、Artifacts 内嵌预览。
- **Artifacts**：HTML 预览沙箱（iframe srcdoc），可全屏/分享/下载。
- **通用 UI**：`ui-lib.tsx`（Modal/List/Toast/Selector…）、`button.tsx`、`emoji.tsx`。

---

## 7. 工具与基础设施（`app/utils`）

| 模块 | 职责 |
|------|------|
| `store.ts` | `createPersistStore` 持久化 store 工厂（见 §3） |
| `indexedDB-storage.ts` | IndexedDB + localStorage 双通道存储适配器 |
| `chat.ts` | SSE 流、图片压缩/缓存/上传、base64 转换 |
| `sync.ts` | 多 store 快照/合并/导出/导入 |
| `model.ts` | 模型表收集/排序/自定义模型解析（`model@provider` 语法） |
| `model-test.ts` | 前端模型连通性测试 |
| `token.ts` | 轻量 token 估算（无 tiktoken，按字符加权） |
| `cloudflare.ts` | Cloudflare AI Gateway URL 重写 |
| `object.ts clone.ts merge.ts format.ts` | 通用工具（omit/pick/deepClone/merge/chunks/prettyObject） |

### 7.1 fetch 适配

`app/utils.ts` 的 `fetch()`：直接使用全局 `window.fetch`（浏览器 CORS 由本地
`/api/*` 代理规避）。上层 `fetchEventSource` 无需改动即可解析 SSE。

### 7.2 图片缓存（ServiceWorker）

`public/serviceWorker.js` 拦截 `/api/cache/*`：POST 上传 → 写入 CacheStorage 并返回
`/api/cache/{nanoid}.{ext}` URL；GET 命中缓存；DELETE 删除。DALL·E 3 生成的图片与
用户上传的图片附件都经此存储，规避服务器磁盘与各平台存储差异。

---

## 8. 配置与环境变量

### 8.1 服务端（`app/config/server.ts`，Docker 部署）

`OPENAI_API_KEY`（支持逗号分隔轮询）、`CODE`（访问码，md5 后比较）、`BASE_URL`、
`OPENAI_ORG_ID`、`CUSTOM_MODELS`、`DEFAULT_MODEL`、`DISABLE_GPT4`、`HIDE_USER_API_KEY`、
`ENABLE_BALANCE_QUERY`、`DISABLE_FAST_LINK`、
`CLOUDFLARE_*`（KV）、`PROXY_URL`（Docker proxychains）等。

### 8.2 构建时（`app/config/build.ts`）

固定 `standalone` 模式；版本号硬编码 `v1.2.0`。

### 8.3 客户端（`app/store/access.ts` + `app/store/config.ts`）

OpenAI URL/Key、`useCustomConfig`、访问码；全局配置（主题、模型、ModelConfig 温度等参数、
功能开关）。`collectModels` 支持 `customModels` 追加/隐藏
（`-model` 前缀隐藏）。

---

## 9. 数据流全景（一次对话请求）

```
用户输入 → Chat 组件 → useChatStore.onUserInput
  → fillTemplateWith（模板填充）
  → 组装上下文 getMessagesWithMemory（系统提示 + 记忆 + context + 最近消息）
  → getClientApi(provider).llm.chat({...})
      → 平台实现（如 ChatGPTApi.chat）
          → path() 解析：/api/openai（本地代理）
          → stream() → fetchEventSource（window.fetch）
              → Next.js /api/[provider] 路由 → auth() 鉴权 → 上游转发
              → SSE 流式返回 → parseSSE → 打字机动画 onUpdate → UI 增量渲染
              → 若含 tool_calls → 执行工具并回填后重新请求
  → onFinish → onNewMessage → 统计 + 标题生成 + 记忆压缩
  → useChatStore update() → IndexedDB 持久化
```

---

## 10. 测试与工程化

- **测试**：Jest + Testing Library（`jest.config.ts`，jsdom 环境），现有
  `test/model-provider.test.ts`（`getModelProvider` 解析）、`test/sum-module.test.ts`；
  `yarn test:ci` 用于 CI。
- **Lint/格式化**：ESLint + Prettier。
- **i18n**：`app/locales/`（cn/en），`merge(fallback, target)` 保证缺字段回退。
- **CI/CD**：`.github/workflows/docker.yml` 构建 Docker 镜像；
  `Dockerfile` 为 standalone 输出 + proxychains 代理支持。

---

## 11. 关键设计决策与扩展点

1. **单一构建模式**（standalone + Docker）是"一套代码服务端/浏览器"的基础：服务端代理隐藏密钥，
   浏览器经本地 `/api/*` 访问上游。
2. **Provider 可扩展**：新增模型提供商 = 在 `constant.ts` 加模型表 + `app/client/platforms/`
   加一个实现 + `app/api/` 加一个 handler（或复用 openai 兼容协议）+ `access.ts` 加配置项，
   其余（UI、记忆、导出）全部复用。
3. **本地优先**：所有数据落 IndexedDB，导出/导入以 JSON 快照合并，
   无服务端账号体系。
4. **安全边界**：服务端只下发非敏感配置（`/api/config`）；访问码 md5 存储比对；
   密钥永不进入客户端构建产物。

---

## 12. 部署方式

> 唯一部署方式：Linux 上运行 Docker 镜像（`limour/next-chat`）+ 浏览器访问。
> 镜像由 `.github/workflows/docker.yml` 在 `release` 发布或手动触发（`workflow_dispatch`）时构建并推送到 Docker Hub。

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

验收标准：

- `docker compose up -d` 后浏览器可直接访问并使用（参考 README 示例）
- `yarn build`（standalone）为唯一构建路径
- `.github/workflows/docker.yml` 为唯一发布通道，镜像推送 `limour/next-chat`