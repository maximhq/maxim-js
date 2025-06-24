import {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import { MaximLogger } from "../logger";
import { v4 as uuid } from "uuid";
import { convertDoGenerateResultToChatCompletionResult, determineProvider, extractMaximMetadataFromOptions, extractModelParameters, parsePromptMessages, processStream } from "./utils";
import { Generation, Session } from "../components";

export function wrapVercelAIModel<T extends LanguageModelV1>(model: T, logger: MaximLogger): T {
  if (model?.specificationVersion === "v1") {
    return new MaximVercelWrapper(model, logger) as unknown as T;
  }
  console.error("[MaximSDK] Unsupported model");
  return model;
}

class MaximVercelWrapper implements LanguageModelV1 {
  constructor(private model: LanguageModelV1, private logger: MaximLogger) { }

  async doGenerate(options: LanguageModelV1CallOptions) {
    // Extracting the maxim object from `providerOptions`
    const maximMetadata = extractMaximMetadataFromOptions(options);

    // Parsing the ai-sdk prompt messages to maxim prompt messages
    const promptMessages = parsePromptMessages(options.prompt);
    let session: Session | undefined = undefined;
    let generation: Generation | undefined = undefined;
    
    // If sessionId is passed, then create a session on Maxim. If not passed, do not create a session
    if(maximMetadata?.sessionId) {
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
      }
      );
      generation.result(convertDoGenerateResultToChatCompletionResult(response));
      generation.end();
      trace.output(response.finishReason === "stop" && response.text ? response.text : response.finishReason === "tool-calls" && response.toolCalls ? JSON.stringify(response.toolCalls) : JSON.stringify(response));

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
      
      // Optionally add error to trace
      trace?.output(`Error: ${(error as Error).message}`);
      
      throw(error)
    } finally {
      span.end();
      trace.end();
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
    if(maximMetadata?.sessionId) {
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

    const spanId = maximMetadata?.spanId ?? uuid();
    const span = trace.span({
      id: spanId,
      name: maximMetadata?.spanName ?? "default-span",
      tags: maximMetadata?.spanTags
    })

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

    try {
      // Calling the original doStream method
      const response = await this.model.doStream(options);

      generation = span.generation({
        id: uuid(),
        name: maximMetadata?.generationName ?? "default-generation",
        provider: determineProvider(this.model.provider),
        model: this.modelId,
        modelParameters: extractModelParameters(options),
        messages: promptMessages
      });
      
      // going through the original stream to collect chunks and pass them without modifications to the stream
      const chunks: LanguageModelV1StreamPart[] = [];
      const stream = response.stream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            chunks.push(chunk); // Collect for logging
            controller.enqueue(chunk); // Pass through immediately
          },
          flush: () => {
            // Process logging after stream ends
            processStream(chunks, span, trace, generation!, this.provider)
              .catch(error => console.error('[Maxim SDK] Background logging failed:', error));
          }
        })
      );

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
      
      // Optionally add error to trace
      trace?.output(`Error: ${(error as Error).message}`);
      
      throw error;
    } finally {
      span.end();
      trace.end();
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