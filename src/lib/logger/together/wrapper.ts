import { Together } from "together-ai";
import { MaximLogger } from "../logger";
import { v4 as uuid } from "uuid";
import { ChatCompletionResult, Generation, Trace } from "../components";
import { Attachment } from "../components/attachment";
import { processTogetherStream } from "./utils";

/**
 * Metadata options for Maxim tracing integration with Together.ai SDK.
 */
export type MaximTogetherProviderMetadata = {
  /** Link your traces to a session */
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
};

/**
 * Wraps a Together.ai client with Maxim logging and tracing capabilities.
 *
 * This function returns a wrapped version of the Together.ai client that integrates
 * Maxim's observability features for completions and image generation.
 *
 * @param client - The Together.ai client instance to wrap.
 * @param logger - The MaximLogger instance to use for tracing and logging.
 * @param maximMetadata - Optional default Maxim metadata to apply to all requests.
 * @returns The wrapped client with Maxim integration.
 */
export function wrapMaximTogetherClient(
  client: Together,
  logger: MaximLogger,
  maximMetadata?: MaximTogetherProviderMetadata
): Together {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "chat") {
        return {
          completions: {
          create: async (options: any) => {
            let generation: Generation | undefined = undefined;

            try {
              const response = await target.chat.completions.create(options);

              let trace: Trace | undefined = undefined;

              if (maximMetadata?.traceId) {
                trace = logger.trace({
                  id: maximMetadata.traceId,
                  name: maximMetadata?.traceName ?? "together-completion",
                  tags: maximMetadata?.traceTags
                });
              } else if (maximMetadata?.sessionId) {
                const session = logger.session({
                  id: maximMetadata.sessionId,
                  name: maximMetadata?.sessionName ?? "default-session",
                  tags: maximMetadata?.sessionTags
                });

                trace = session.trace({
                  id: uuid(),
                  name: maximMetadata?.traceName ?? "together-completion",
                  tags: maximMetadata?.traceTags
                });
              } else {
                trace = logger.trace({
                  id: uuid(),
                  name: maximMetadata?.traceName ?? "together-completion",
                  tags: maximMetadata?.traceTags
                });
              }

              generation = trace.generation({
                id: uuid(),
                name: maximMetadata?.generationName ?? "default-generation",
                provider: "together",
                model: options.model || "unknown",
                messages: options.messages,
                modelParameters: options,
                tags: maximMetadata?.generationTags,
              });

              generation.result(response as ChatCompletionResult);
              generation.end();
              trace.end();

              return response;
            } catch (error) {
              if (generation) {
                generation.error({ message: (error as Error).message });
                generation.end();
              }
              console.error('[MaximSDK] Together.ai chat completion failed:', error);
              throw error;
            }
          },
          stream: (options: any) => {
            let generation: Generation | undefined = undefined;

            try {
              const response = target.chat.completions.stream(options);

              let trace: Trace | undefined = undefined;

              if (maximMetadata?.traceId) {
                trace = logger.trace({
                  id: maximMetadata.traceId,
                  name: maximMetadata?.traceName ?? "together-completion",
                  tags: maximMetadata?.traceTags
                });
              } else if (maximMetadata?.sessionId) {
                const session = logger.session({
                  id: maximMetadata.sessionId,
                  name: maximMetadata?.sessionName ?? "default-session",
                  tags: maximMetadata?.sessionTags
                });

                trace = session.trace({
                  id: uuid(),
                  name: maximMetadata?.traceName ?? "together-completion",
                  tags: maximMetadata?.traceTags
                });
              } else {
                trace = logger.trace({
                  id: uuid(),
                  name: maximMetadata?.traceName ?? "together-completion",
                  tags: maximMetadata?.traceTags
                });
              }

              generation = trace.generation({
                id: uuid(),
                name: maximMetadata?.generationName ?? "default-generation",
                provider: "together",
                model: options.model,
                messages: options.messages,
                modelParameters: options,
                tags: maximMetadata?.generationTags,
              });

              const processedStream = processTogetherStream(response, trace, generation, options.model, maximMetadata);
              return processedStream;

            } catch (error) {
              if (generation) {
                generation.error({
                  message: (error as Error).message
                });
                generation.end();
              }

              console.error('[MaximSDK] Together.ai chat completion stream failed:', error);
              throw error;
            }
          }
        }
        };
      }

      if (prop === "images") {
        return {
          create: async (options: any) => {
            let generation: Generation | undefined = undefined;

            try {
              const response = await target.images.create(options);

              let trace: Trace | undefined = undefined;

              if (maximMetadata?.traceId) {
                trace = logger.trace({
                  id: maximMetadata.traceId,
                  name: maximMetadata?.traceName ?? "together-image-generation",
                  tags: maximMetadata?.traceTags
                });
              } else if (maximMetadata?.sessionId) {
                const session = logger.session({
                  id: maximMetadata.sessionId,
                  name: maximMetadata?.sessionName ?? "default-session",
                  tags: maximMetadata?.sessionTags
                });

                trace = session.trace({
                  id: uuid(),
                  name: maximMetadata?.traceName ?? "together-image-generation",
                  tags: maximMetadata?.traceTags
                });
              } else {
                trace = logger.trace({
                  id: uuid(),
                  name: maximMetadata?.traceName ?? "together-image-generation",
                  tags: maximMetadata?.traceTags
                });
              }

              generation = trace.generation({
                id: uuid(),
                name: maximMetadata?.generationName ?? "default-generation",
                provider: "together",
                model: options.model || "unknown",
                messages: [{ role: "user", content: options.prompt }],
                modelParameters: options,
                tags: maximMetadata?.generationTags,
              });

              if (response.data && Array.isArray(response.data)) {
                response.data.forEach((imageData: any, index: number) => {
                  let attachment: Attachment;

                  if (imageData.url) {
                    attachment = {
                      id: uuid(),
                      type: "url",
                      url: imageData.url,
                      name: `generated-image-${index + 1}`,
                    };
                  } else if (imageData.b64_json) {
                    const base64Data = imageData.b64_json;
                    const binaryData = Buffer.from(base64Data, 'base64');

                    attachment = {
                      id: uuid(),
                      type: "fileData",
                      data: binaryData,
                      name: `generated-image-${index + 1}.png`,
                    };
                  } else {
                    return;
                  }

                  generation?.addAttachment(attachment);
                });
              }

              const completionResult: ChatCompletionResult = {
                id: uuid(),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: options.model || "unknown",
                choices: [{
                  index: 0,
                  message: {
                    role: "assistant",
                    content: `Generated ${response.data?.length || 0} image(s) for prompt: "${options.prompt}"`
                  },
                  logprobs: null,
                  finish_reason: "stop"
                }],
                usage: {
                  prompt_tokens: 0,
                  completion_tokens: 0,
                  total_tokens: 0
                }
              };

              generation.result(completionResult);
              generation.end();
              trace.end();

              return response;
            } catch (error) {
              if (generation) {
                generation.error({ message: (error as Error).message });
                generation.end();
              }
              console.error('[MaximSDK] Together.ai image generation failed:', error);
              throw error;
            }
          }
        };
      }

      return Reflect.get(target, prop, receiver);
    }
  }) as Together;
}