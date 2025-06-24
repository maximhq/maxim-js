import {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import { MaximLogger } from "../logger";
import { v4 as uuid } from "uuid";
import { convertDoGenerateResultToChatCompletionResult, determineProvider, extractMaximMetadataFromOptions, extractModelParameters, parsePromptMessages, processStream } from "./utils";
import { Generation, Session } from "../components";

export function wrapMaximAISDKModel<T extends LanguageModelV1>(model: T, logger: MaximLogger): T {
  if (model?.specificationVersion === "v1") {
    return new MaximAISDKWrapper(model, logger) as unknown as T;
  }
  console.error("[MaximSDK] Unsupported model");
  return model;
}

class MaximAISDKWrapper implements LanguageModelV1 {
  constructor(private model: LanguageModelV1, private logger: MaximLogger) { }

  async doGenerate(options: LanguageModelV1CallOptions) {
    // Extracting the maxim object from `providerOptions`
    const maximMetadata = extractMaximMetadataFromOptions(options);

    // Parsing the ai-sdk prompt messages to maxim prompt messages
    const promptMessages = parsePromptMessages(options.prompt);
    let session: Session | undefined = undefined;
    let generation: Generation | undefined = undefined;

    // If sessionId is passed, then create a session on Maxim. If not passed, do not create a session
    if (maximMetadata?.sessionId) {
      session = this.logger.session({
        id: maximMetadata.sessionId,
        name: maximMetadata.sessionName ?? "default-session",
        tags: maximMetadata.sessionTags
      })
    }

    // If the user passes in a traceId, we push to the existing trace or else we create a new trace
    const trace = session ? session.trace({
      id: maximMetadata?.traceId ?? uuid(),
      name: maximMetadata?.traceName ?? "default-trace",
      tags: maximMetadata?.traceTags
    }) : this.logger.trace({
      id: maximMetadata?.traceId ?? uuid(),
      name: maximMetadata?.traceName ?? "default-trace",
      tags: maximMetadata?.traceTags
    })

    const span = trace.span({
      id: maximMetadata?.spanId ?? uuid(),
      name: maximMetadata?.spanName ?? "default-span",
      tags: maximMetadata?.spanTags
    })

    // Getting the user input
    if (!maximMetadata?.traceId) {
      const userMessage = promptMessages.find((msg) => msg.role === "user");
      const userInput = userMessage?.content;
      if (userInput) {
        if (typeof userInput === "string") {
          trace.input(userInput);
        } else {
          const userMessage = userInput[0];
          switch (userMessage.type) {
            case "text":
              trace.input(userMessage.text)
              break;
            case "image_url":
              trace.input(userMessage.image_url.url);
              break;
            default:
              break;
          }
        }
      }
    }

    try {
      // Calling the original doGenerate function
      const response = await this.model.doGenerate(options);
      
      generation = span.generation({
        id: uuid(),
        name: maximMetadata?.generationName ?? "default-generation",
        provider: determineProvider(this.model.provider),
        model: this.modelId,
        messages: promptMessages,
        modelParameters: extractModelParameters(options),
        tags: maximMetadata?.generationTags,
      });
      const res = convertDoGenerateResultToChatCompletionResult(response);
      generation.result(res);
      generation.end();

      return response;
    } catch (error) {
      if (generation) {
        generation.error({
          message: (error as Error).message
        });
        generation.end();
      }

      // Log error details
      console.error('[MaximSDK] doGenerate failed:', error);

      throw (error)
    } finally {
      span.end();
      if (!maximMetadata?.traceId) trace.end();
    }
  }

  async doStream(options: LanguageModelV1CallOptions) {
    // Extracting the maxim object from `providerOptions`
    const maximMetadata = extractMaximMetadataFromOptions(options);

    // Parsing the ai-sdk prompt messages to maxim prompt messages
    const promptMessages = parsePromptMessages(options.prompt);

    let session: Session | undefined = undefined;
    let generation: Generation | undefined = undefined;

    // If sessionId is passed, then create a session on Maxim. If not passed, do not create a session
    if (maximMetadata?.sessionId) {
      session = this.logger.session({
        id: maximMetadata.sessionId,
        name: maximMetadata.sessionName ?? "default-session",
        tags: maximMetadata.sessionTags
      })
    }

    const trace = session ? session.trace({
      id: maximMetadata?.traceId ?? uuid(),
      name: maximMetadata?.traceName ?? "default-trace",
      tags: maximMetadata?.traceTags
    }) : this.logger.trace({
      id: maximMetadata?.traceId ?? uuid(),
      name: maximMetadata?.traceName ?? "default-trace",
      tags: maximMetadata?.traceTags
    })

    const spanId = maximMetadata?.spanId ?? uuid();
    const span = trace.span({
      id: spanId,
      name: maximMetadata?.spanName ?? "default-span",
      tags: maximMetadata?.spanTags
    })

    if (!maximMetadata?.traceId) {
      const userMessage = promptMessages.find((msg) => msg.role === "user");
      const userInput = userMessage?.content;
      if (userInput) {
        if (typeof userInput === "string") {
          trace.input(userInput);
        } else {
          const userMessage = userInput[0];
          switch (userMessage.type) {
            case "text":
              trace.input(userMessage.text)
              break;
            case "image_url":
              trace.input(userMessage.image_url.url);
              break;
            default:
              break;
          }
        }
      }
    }

    try {
      // Calling the original doStream method
      const response = await this.model.doStream(options);
      const modelProvider = determineProvider(this.model.provider);

      generation = span.generation({
        id: uuid(),
        name: maximMetadata?.generationName ?? "default-generation",
        provider: modelProvider,
        model: this.modelId,
        modelParameters: extractModelParameters(options),
        messages: promptMessages
      });

      // going through the original stream to collect chunks and pass them without modifications to the stream
      const chunks: LanguageModelV1StreamPart[] = [];
      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        async start(controller) {
          try {
            const reader = response.stream.getReader();

            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                // Stream is done, now process before closing
                try {
                  processStream(chunks, span, trace, generation!, modelProvider);
                } catch (error) {
                  console.error('[MaximSDK] Processing failed:', error);
                  if (generation) {
                    generation.error({
                      message: (error as Error).message
                    });
                    generation.end();
                  }
                }

                // Now close the stream
                controller.close();
                break;
              }

              // Collect chunk and pass it through
              chunks.push(value);
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
            if (generation) {
              generation.error({
                message: (error as Error).message
              });
              generation.end();
            }
          }
        }
      });

      // Return response with the logging stream - user gets real-time data without additional delay
      return {
        ...response,
        stream: stream
      };
    } catch (error) {
      if (generation) {
        generation.error({
          message: (error as Error).message
        });
        generation.end();
      }

      // Log error details
      console.error('[MaximSDK] doGenerate failed:', error);

      throw error;
    } finally {
      span.end();
      if (!maximMetadata?.traceId) trace.end();
    }
  }

  get defaultObjectGenerationMode() {
    return this.model.defaultObjectGenerationMode;
  }

  get modelId() {
    return this.model.modelId;
  }

  get provider() {
    return this.model.provider;
  }

  get specificationVersion() {
    return this.model.specificationVersion;
  }

  get supportsImageUrls() {
    return this.model.supportsImageUrls;
  }

  get supportsStructuredOutputs() {
    return this.model.supportsStructuredOutputs;
  }

  get supportsUrl() {
    return this.model.supportsUrl;
  }
}