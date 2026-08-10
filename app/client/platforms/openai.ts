"use client";
// azure and openai, using same models. so using same LLMApi.
import {
  ApiPath,
  DEFAULT_MODELS,
  OpenaiPath,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import {
  useAccessStore,
  useAppConfig,
  useChatStore,
} from "@/app/store";
import {
  preProcessImageContent,
  uploadImage,
  base64Image2Blob,
  stream,
} from "@/app/utils/chat";
import { cloudflareAIGatewayUrl } from "@/app/utils/cloudflare";
import { DalleSize, DalleQuality, DalleStyle } from "@/app/typing";

import {
  ApiFormat,
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  LLMUsage,
  MultimodalContent,
} from "../api";
import Locale from "../../locales";
import {
  getMessageTextContent,
  isVisionModel,
  isDalle3 as _isDalle3,
  getMessageTextContentWithoutThinking,
} from "@/app/utils";
import { fetch } from "@/app/utils";

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64" | "url";
        media_type?: string;
        data?: string;
        url?: string;
      };
    };

export type ResponsesContentBlock =
  | { type: "input_text" | "output_text"; text: string }
  | { type: "input_image"; image_url: string };

export interface AnthropicMessageRequestPayload {
  model: string;
  system?: string;
  messages: {
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[];
  }[];
  max_tokens?: number;
  stream?: boolean;
}

export interface OpenAIResponsesRequestPayload {
  model: string;
  instructions?: string;
  input: {
    role: "user" | "assistant" | "system";
    content: string | ResponsesContentBlock[];
  }[];
  stream?: boolean;
}

export interface DalleRequestPayload {
  model: string;
  prompt: string;
  response_format: "url" | "b64_json";
  n: number;
  size: DalleSize;
  quality: DalleQuality;
  style: DalleStyle;
}

/**
 * 将 NeatChat 的消息内容转换为 anthropic-messages 格式的 content blocks
 */
function convertToAnthropicContent(
  content: string | MultimodalContent[],
): string | AnthropicContentBlock[] {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part): AnthropicContentBlock => {
    if (part.type === "image_url" && part.image_url?.url) {
      const url = part.image_url.url;
      // data:image/png;base64,....  ->  base64 source
      const match = url.match(/^data:(.*?);base64,(.*)$/s);
      if (match) {
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: match[1],
            data: match[2],
          },
        };
      }
      return {
        type: "image",
        source: { type: "url", url },
      };
    }
    return { type: "text", text: part.text || "" };
  });
}

/**
 * 将 NeatChat 的消息内容转换为 openai-responses 格式的 content blocks
 */
function convertToResponsesContent(
  content: string | MultimodalContent[],
  textType: "input_text" | "output_text" = "input_text",
): string | ResponsesContentBlock[] {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part): ResponsesContentBlock => {
    if (part.type === "image_url" && part.image_url?.url) {
      return { type: "input_image", image_url: part.image_url.url };
    }
    return { type: textType, text: part.text || "" };
  });
}

interface SSEParseState {
  isInThinking: boolean;
  setInThinking: (v: boolean) => void;
}

/**
 * 解析 anthropic-messages SSE 流
 * events: content_block_delta (text_delta / thinking_delta)
 */
function parseAnthropicSSE(text: string, state: SSEParseState): string | undefined {
  const json = JSON.parse(text);
  if (json.type === "content_block_delta") {
    const delta = json.delta;
    if (delta?.type === "text_delta" && delta?.text) {
      if (state.isInThinking) {
        state.setInThinking(false);
        return "\n response\n\n" + delta.text;
      }
      return delta.text;
    }
    if (delta?.type === "thinking_delta" && delta?.thinking) {
      if (!state.isInThinking) {
        state.setInThinking(true);
        return " thinking\n" + delta.thinking;
      }
      return delta.thinking;
    }
  }
  return undefined;
}

/**
 * 解析 openai-responses SSE 流
 * events: response.output_text.delta / response.reasoning_summary_text.delta
 */
function parseResponsesSSE(text: string, state: SSEParseState): string | undefined {
  const json = JSON.parse(text);
  if (json.type === "response.output_text.delta" && json.delta) {
    if (state.isInThinking) {
      state.setInThinking(false);
      return "\n response\n\n" + json.delta;
    }
    return json.delta;
  }
  if (json.type === "response.reasoning_summary_text.delta" && json.delta) {
    if (!state.isInThinking) {
      state.setInThinking(true);
      return " thinking\n" + json.delta;
    }
    return json.delta;
  }
  return undefined;
}

export class ChatGPTApi implements LLMApi {
  private disableListModels = true;

  path(path: string): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = "";

    if (accessStore.useCustomConfig) {
      baseUrl = accessStore.openaiUrl;
    }

    if (baseUrl.length === 0) {
      baseUrl = ApiPath.OpenAI;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.OpenAI)) {
      baseUrl = "https://" + baseUrl;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);

    // try rebuild url, when using cloudflare ai gateway in client
    return cloudflareAIGatewayUrl([baseUrl, path].join("/"));
  }

  async extractMessage(res: any, apiFormat: ApiFormat = "openai-responses") {
    if (res.error) {
      return "```\n" + JSON.stringify(res, null, 4) + "\n```";
    }
    // dalle3 model return url, using url create image message
    if (res.data) {
      let url = res.data?.at(0)?.url ?? "";
      const b64_json = res.data?.at(0)?.b64_json ?? "";
      if (!url && b64_json) {
        // uploadImage
        url = await uploadImage(base64Image2Blob(b64_json, "image/png"));
      }
      return [
        {
          type: "image_url",
          image_url: {
            url,
          },
        },
      ];
    }

    if (apiFormat === "anthropic-messages") {
      // anthropic-messages: content is an array of blocks
      const text = res.content
        ?.map?.((block: any) => (block?.type === "text" ? block?.text : ""))
        .filter(Boolean)
        .join("");
      return text || res;
    }

    // openai-responses: top-level output_text or output[].content[].text
    if (typeof res.output_text === "string" && res.output_text.length > 0) {
      return res.output_text;
    }
    const outputText = res.output
      ?.map?.((item: any) =>
        item?.content
          ?.map?.((c: any) => (c?.type === "output_text" ? c?.text : ""))
          .filter(Boolean)
          .join(""),
      )
      .filter(Boolean)
      .join("");
    return outputText || res;
  }

  async chat(options: ChatOptions) {
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
        providerName: options.config.providerName,
      },
    };

    const accessStore = useAccessStore.getState();
    const apiFormat: ApiFormat = accessStore.apiFormat || "openai-responses";

    let requestPayload:
      | AnthropicMessageRequestPayload
      | OpenAIResponsesRequestPayload
      | DalleRequestPayload;

    const isDalle3 = _isDalle3(options.config.model);
    if (isDalle3) {
      const prompt = getMessageTextContent(
        options.messages.slice(-1)?.pop() as any,
      );
      requestPayload = {
        model: options.config.model,
        prompt,
        // URLs are only valid for 60 minutes after the image has been generated.
        response_format: "b64_json", // using b64_json, and save image in CacheStorage
        n: 1,
        size: options.config?.size ?? "1024x1024",
        quality: options.config?.quality ?? "standard",
        style: options.config?.style ?? "vivid",
      };
    } else if (apiFormat === "anthropic-messages") {
      const visionModel = isVisionModel(options.config.model);
      const messages: AnthropicMessageRequestPayload["messages"] = [];
      let systemText = "";

      for (const v of options.messages) {
        const content = visionModel
          ? await preProcessImageContent(v.content)
          : v.role === "assistant"
          ? getMessageTextContentWithoutThinking(v)
          : getMessageTextContent(v);

        if (v.role === "system") {
          // anthropic: system 放顶层 system 字段
          systemText += (systemText ? "\n\n" : "") + content;
          continue;
        }

        const anthropicContent = convertToAnthropicContent(content);
        messages.push({
          role: v.role as "user" | "assistant",
          content: anthropicContent,
        });
      }

      requestPayload = {
        model: modelConfig.model,
        system: systemText || undefined,
        messages,
        max_tokens: modelConfig.max_tokens,
        stream: options.config.stream,
      };
    } else {
      // openai-responses
      const visionModel = isVisionModel(options.config.model);
      const input: OpenAIResponsesRequestPayload["input"] = [];
      let instructions = "";

      for (const v of options.messages) {
        const content = visionModel
          ? await preProcessImageContent(v.content)
          : v.role === "assistant"
          ? getMessageTextContentWithoutThinking(v)
          : getMessageTextContent(v);

        if (v.role === "system") {
          // openai-responses: system 放 instructions 字段
          instructions += (instructions ? "\n\n" : "") + content;
          continue;
        }

        const responsesContent = convertToResponsesContent(
          content,
          v.role === "assistant" ? "output_text" : "input_text",
        );
        input.push({ role: v.role as "user" | "assistant", content: responsesContent });
      }

      requestPayload = {
        model: modelConfig.model,
        instructions: instructions || undefined,
        input,
        stream: options.config.stream,
      };
    }

    console.log(`[Request] ${apiFormat} payload: `, requestPayload);

    const shouldStream = !isDalle3 && !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const chatPath = this.path(
        isDalle3
          ? OpenaiPath.ImagePath
          : apiFormat === "anthropic-messages"
          ? OpenaiPath.MessagesPath
          : OpenaiPath.ResponsesPath,
      );
      if (shouldStream) {
        let isInThinking = false;

        const parseSSE = apiFormat === "anthropic-messages"
          ? parseAnthropicSSE
          : parseResponsesSSE;

        stream(
          chatPath,
          requestPayload,
          getHeaders(),
          controller,
          // parseSSE
          (text: string) => {
            return parseSSE(text, {
              isInThinking,
              setInThinking: (v: boolean) => {
                isInThinking = v;
              },
            });
          },
          options,
        );
      } else {
        const chatPayload = {
          method: "POST",
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
          headers: getHeaders(),
        };

        // make a fetch request
        const requestTimeoutId = setTimeout(
          () => controller.abort(),
          isDalle3 ? REQUEST_TIMEOUT_MS * 4 : REQUEST_TIMEOUT_MS, // dalle3 using b64_json is slow.
        );

        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = await this.extractMessage(resJson, apiFormat);
        options.onFinish(message, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }
  async usage() {
    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
        .getDate()
        .toString()
        .padStart(2, "0")}`;
    const ONE_DAY = 1 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = formatDate(startOfMonth);
    const endDate = formatDate(new Date(Date.now() + ONE_DAY));

    const [used, subs] = await Promise.all([
      fetch(
        this.path(
          `${OpenaiPath.UsagePath}?start_date=${startDate}&end_date=${endDate}`,
        ),
        {
          method: "GET",
          headers: getHeaders(),
        },
      ),
      fetch(this.path(OpenaiPath.SubsPath), {
        method: "GET",
        headers: getHeaders(),
      }),
    ]);

    if (used.status === 401) {
      throw new Error(Locale.Error.Unauthorized);
    }

    if (!used.ok || !subs.ok) {
      throw new Error("Failed to query usage from openai");
    }

    const response = (await used.json()) as {
      total_usage?: number;
      error?: {
        type: string;
        message: string;
      };
    };

    const total = (await subs.json()) as {
      hard_limit_usd?: number;
    };

    if (response.error && response.error.type) {
      throw Error(response.error.message);
    }

    if (response.total_usage) {
      response.total_usage = Math.round(response.total_usage) / 100;
    }

    if (total.hard_limit_usd) {
      total.hard_limit_usd = Math.round(total.hard_limit_usd * 100) / 100;
    }

    return {
      used: response.total_usage,
      total: total.hard_limit_usd,
    } as LLMUsage;
  }

  async models(): Promise<LLMModel[]> {
    if (this.disableListModels) {
      return DEFAULT_MODELS.slice();
    }

    const res = await fetch(this.path(OpenaiPath.ListModelPath), {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    const resJson = (await res.json()) as OpenAIListModelResponse;
    const chatModels = resJson.data?.filter(
      (m) => m.id.startsWith("gpt-") || m.id.startsWith("chatgpt-"),
    );
    console.log("[Models]", chatModels);

    if (!chatModels) {
      return [];
    }

    //由于目前 OpenAI 的 disableListModels 默认为 true，所以当前实际不会运行到这场
    let seq = 1000; //同 Constant.ts 中的排序保持一致
    return chatModels.map((m) => ({
      name: m.id,
      available: true,
      sorted: seq++,
      provider: {
        id: "openai",
        providerName: "OpenAI",
        providerType: "openai",
        sorted: 1,
      },
    }));
  }
}
export { OpenaiPath };
