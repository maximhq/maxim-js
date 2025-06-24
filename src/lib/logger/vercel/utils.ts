import { ChatCompletionMessage, ChatCompletionResult, CompletionRequest, Generation, Span, Trace } from "index";
import { v4 as uuid } from "uuid";
import {
  LanguageModelV1CallOptions,
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import { CompletionRequestContent } from "../../models/prompt";

export function determineProvider(
  model: string,
): "openai" | "bedrock" | "anthropic" | "huggingface" | "azure" | "together" | "groq" | "google" {
  const mapper = (param: string) => {
    if (param.includes("azure")) return "azure";
    if (param.includes("azure_openai")) return "azure";
    if (param.includes("amazon_bedrock")) return "bedrock";
    if (param.includes("bedrock")) return "bedrock";
    if (param.includes("huggingface")) return "huggingface";
    if (param.includes("together")) return "together";
    if (param.includes("openai")) return "openai";
    if (param.includes("anthropic")) return "anthropic";
    if (param.includes("google")) return "google";
    if (param.includes("groq")) return "groq";

    return null;
  };

  const provider = mapper(model);

  if (provider !== null) {
    return provider;
  }

  return "openai";
}

export function extractModelParameters(options: LanguageModelV1CallOptions) {
  return {
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    topP: options.topP,
    topK: options.topK,
    frequencyPenalty: options.frequencyPenalty,
    stopSequences: options.stopSequences,
    seed: options.seed,
    headers: options.headers,
    presencePenalty: options.presencePenalty,
    abortSignal: options.abortSignal,
    responseFormat: options.responseFormat
  }
}

export type MaximVercelProviderMetadata = {
  /** Link your traces to existing sessions */
  sessionId?: string;
  /** Override session name */
  sessionName?: string;
  /** Add tags to session */
  sessionTags?: Record<string, string>; 
  /** Pass in an existing trace's id */
  traceId?: string;
  /** Override trace name */
  traceName?: string;
  /** Add tags to trace */
  traceTags?: Record<string, string>;
  /** Pass in a custom generation name */
  generationName?: string;
  /** Add tags to generation */
  generationTags?: Record<string, string>;
  /** Pass in a specific span id */
  spanId?: string;
  /** Override span name */
  spanName?: string;
  /** Add tags to generation */
  spanTags?: Record<string, string>;
}

export function extractMaximMetadataFromOptions(options: LanguageModelV1CallOptions) {
  const metadata = options.providerMetadata;
  if (!metadata || !metadata['maxim']) return undefined;
  const maximMetadata = metadata['maxim'] as MaximVercelProviderMetadata;
  return {
    ...maximMetadata,
    spanId: maximMetadata.spanId ?? uuid(),
  } as MaximVercelProviderMetadata;
}


export function parsePromptMessages(prompt: LanguageModelV1Prompt): Array<CompletionRequest | ChatCompletionMessage> {

  const promptMessages: Array<CompletionRequest | ChatCompletionMessage> = prompt.map((promptMsg) => {
    switch (promptMsg.role) {
      case "system": {
        return [
          {
            role: "system",
            content: promptMsg.content,
          },
        ] as Array<CompletionRequest | ChatCompletionMessage>
      }
      case "user": {
        return [
          {
            role: "user",
            content: promptMsg.content.map((msg): CompletionRequestContent => {
              switch (msg.type) {
                case "text":
                  return {
                    type: "text",
                    text: msg.text
                  };
                case "image":
                  return {
                    type: "image_url",
                    image_url: {
                      url: msg.image.toString(),
                    },
                  };
                default:
                  return msg as any;
              }
            }),
          }
        ] as Array<CompletionRequest | ChatCompletionMessage>
      }
      case "assistant": {
        const assistantText = promptMsg.content.find((msg) => msg.type === "text");
        const assistantToolCalls = promptMsg.content.filter((msg) => msg.type === "tool-call");
        return [
          {
            role: "assistant",
            content: assistantText?.text ? assistantText.text : null,
            tool_calls: assistantToolCalls.map((tool) => ({
              id: tool.toolCallId,
              type: "function",
              function: {
                name: tool.toolName,
                arguments: JSON.stringify(tool.args)
              }
            }))
          },
        ] as Array<CompletionRequest | ChatCompletionMessage>;
      }
      case "tool": {
        return promptMsg.content.map((part) => ({
          role: "tool",
          tool_call_id: part.toolCallId,
          content: JSON.stringify(part.result),
        })) as Array<CompletionRequest | ChatCompletionMessage>;
      }
    }
  }).flat()

  return promptMessages;
}

export function convertDoGenerateResultToChatCompletionResult(result: any): ChatCompletionResult {
  return {
    id: uuid(),
    object: "chat_completion",
    created: Math.floor(Date.now() / 1000),
    model: result.response.model_id ?? result.response.modelId ?? "unknown",
    choices: result.rawResponse.body.choices ?? result.rawResponse.body.content ?? [],
    usage: {
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      total_tokens: result.usage.promptTokens + result.usage.completionTokens
    }
  }
}

export function processStream(
  chunks: LanguageModelV1StreamPart[],
  span: Span,
  trace: Trace,
  generation: Generation,
  model: string
) {
  try {
    const result = processChunks(chunks);

    generation.result({
        id: uuid(),
        object: "chat_completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          text: result.text,
          finish_reason: result.finishReason ?? "stop",
          logprobs: null
        }],
        usage: {
          prompt_tokens: result.usage?.promptTokens ?? 0,
          completion_tokens: result.usage?.completionTokens ?? 0,
          total_tokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0)
        }
    });
    generation.end();
    
    trace.output(
      result.text 
          ? result.text 
          : result.toolCalls 
            ? JSON.stringify(result.toolCalls) 
            : JSON.stringify(result)
    );

  } catch (error) {
    generation.error({
      message: (error as Error).message
    })
    console.error('[Maxim SDK] Logging failed:', error);
  } finally {
    span.end();
    trace.end();
  }
}

function processChunks(chunks: LanguageModelV1StreamPart[]) {
  let text = "";
  const toolCalls: Record<string, any> = {};
  let usage: {
    promptTokens: number,
    completionTokens: number
  } | undefined = undefined;
  let finishReason: string | undefined = undefined;

  for (const chunk of chunks) {
    switch (chunk.type) {
      case "text-delta":
        text += chunk.textDelta;
        break;
      case "tool-call":
        toolCalls[chunk.toolCallId] = chunk;
        break;
      case "tool-call-delta":
        if (!toolCalls[chunk.toolCallId]) {
          toolCalls[chunk.toolCallId] = {
            toolCallType: chunk.toolCallType,
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            args: "",
          };
        }
        toolCalls[chunk.toolCallId].args += chunk.argsTextDelta;
        break;
      case "finish":
        usage = chunk.usage;
        finishReason = chunk.finishReason;
        break;
    }
  }

  return { text, toolCalls: Object.values(toolCalls), usage, finishReason };
}