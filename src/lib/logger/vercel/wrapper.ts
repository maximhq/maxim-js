import type { LanguageModelV1, LanguageModelV1CallOptions, LanguageModelV1StreamPart } from "ai-sdk-provider-v1";
import type { LanguageModelV2 } from "ai-sdk-provider-v2";
import { MaximLogger } from "../logger";
import { v4 as uuid } from "uuid";
import {
	convertDoGenerateResultToChatCompletionResult,
	determineProvider,
	extractMaximMetadataFromOptions,
	extractModelParameters,
	LanguageFirstTokenModel,
	parsePromptMessages,
	processStream,
} from "./utils";
import { Generation, Session, Trace } from "../components";
import { MaximAISDKWrapperV2 } from "./wrapperV2";
import { ChatCompletionMessage, CompletionRequest } from "src/lib/models/prompt";

/**
 * Wraps a Vercel AI SDK language model with Maxim logging and tracing capabilities.
 *
 * This function checks if the provided model implements the v1 specification, and if so,
 * returns a wrapped version that integrates Maxim's observability features. If the model
 * is not supported, it logs an error and returns the original model.
 *
 * @template T - The type of the language model (must extend LanguageModelV1).
 * @param model - The Vercel AI SDK language model instance to wrap.
 * @param logger - The MaximLogger instance to use for tracing and logging.
 * @returns The wrapped model with Maxim integration, or the original model if unsupported.
 */
export function wrapMaximAISDKModel<T extends LanguageModelV1 | LanguageModelV2>(model: T, logger: MaximLogger): T {
	if (model?.specificationVersion === "v1") {
		return new MaximAISDKWrapper(model, logger) as unknown as T;
	}
	if (model?.specificationVersion === "v2") {
		return new MaximAISDKWrapperV2(model, logger) as unknown as T;
	}
	console.error("[MaximSDK] Unsupported model");
	return model;
}

/**
 * A wrapper class that adds Maxim logging and tracing to a Vercel AI SDK language model.
 *
 * This class decorates a LanguageModelV1 instance, intercepting calls to provide
 * advanced observability, tracing, and logging via the MaximLogger. It is intended
 * for internal use by the wrapMaximAISDKModel function.
 *
 * @class
 * @template T - The type of the language model (must extend LanguageModelV1).
 * @param model - The Vercel AI SDK language model instance to wrap.
 * @param logger - The MaximLogger instance to use for tracing and logging.
 */
class MaximAISDKWrapper implements LanguageModelV1 {
	// Internal state to track trace across multiple doGenerate calls in a tool-call sequence
	private currentTraceId: string | null = null;
	private currentTrace: Trace | null = null;
	private currentSession: Session | null = null;
	private isInToolCallSequence: boolean = false;

	/**
	 * @constructor
	 * Creates a new MaximAISDKWrapper instance.
	 *
	 * @param model - The Vercel AI SDK language model instance to wrap.
	 * @param logger - The MaximLogger instance to use for tracing and logging.
	 */
	constructor(
		private model: LanguageModelV1,
		private logger: MaximLogger,
	) {}

	/**
	 * Sets up Maxim logging and tracing for a model call.
	 *
	 * Extracts Maxim metadata, parses prompt messages, and initializes session, trace, and span objects.
	 * Also logs user input to the trace if appropriate.
	 *
	 * @private
	 * @param options - The call options for the model invocation.
	 * @param promptMessages - The parsed prompt messages (used to detect tool calls).
	 * @returns An object containing maximMetadata, trace, session, span, and promptMessages.
	 */
	private setupLogging(options: LanguageModelV1CallOptions, promptMessages: Array<CompletionRequest | ChatCompletionMessage>) {
		// Extracting the maxim object from `providerOptions`
		const maximMetadata = extractMaximMetadataFromOptions(options.providerMetadata);

		// Check if this is a continuation of a tool-call sequence (has tool results in prompt)
		const hasToolResults = promptMessages.some((msg) => msg.role === "tool");

		// Determine if we should reuse the existing trace or create a new one
		const shouldReuseTrace =
			!maximMetadata?.traceId && // User hasn't explicitly provided a traceId
			this.isInToolCallSequence && // We're in a tool-call sequence
			hasToolResults && // This call has tool results (continuation)
			this.currentTraceId !== null; // We have an existing trace

		let session: Session | undefined = undefined;
		let trace: Trace;

		// If sessionId is passed, then create a session on Maxim. If not passed, do not create a session
		if (maximMetadata?.sessionId) {
			// Reuse existing session if it's the same sessionId, otherwise create new
			if (this.currentSession?.id === maximMetadata.sessionId) {
				session = this.currentSession;
			} else {
				session = this.logger.session({
					id: maximMetadata.sessionId,
					name: maximMetadata.sessionName ?? "default-session",
					tags: maximMetadata.sessionTags,
				});
				this.currentSession = session;
			}
		}

		// Determine trace ID: use user-provided, reuse existing, or create new
		const traceId = maximMetadata?.traceId ?? (shouldReuseTrace ? this.currentTraceId! : uuid());
		const traceName = maximMetadata?.traceName ?? "default-trace";

		// Reuse existing trace if we're continuing a tool-call sequence
		if (shouldReuseTrace && this.currentTrace) {
			trace = this.currentTrace;
		} else {
			// Create new trace
			trace = session
				? session.trace({
						id: traceId,
						name: traceName,
						tags: maximMetadata?.traceTags,
					})
				: this.logger.trace({
						id: traceId,
						name: traceName,
						tags: maximMetadata?.traceTags,
					});

			// Store trace state for reuse
			this.currentTraceId = traceId;
			this.currentTrace = trace;
		}

		// If this is the start of a new sequence (no tool results), reset the tool-call sequence flag
		if (!hasToolResults && !maximMetadata?.traceId) {
			this.isInToolCallSequence = false;
		}

		const userMessage = promptMessages.findLast((msg) => msg.role === "user");
		if (userMessage && userMessage.content) {
			const userInput = userMessage.content;
			if (typeof userInput === "string") {
				trace.input(userInput);
			} else {
				const userMessageContent = userInput[0];
				switch (userMessageContent.type) {
					case "text":
						trace.input(userMessageContent.text);
						break;
					case "image_url":
						trace.input(userMessageContent.image_url.url);
						trace.addAttachment({
							id: uuid(),
							type: "url",
							url: userMessageContent.image_url.url,
						});
						break;
					default:
						break;
				}
			}
		}

		const span = trace.span({
			id: maximMetadata?.spanId ?? uuid(),
			name: maximMetadata?.spanName ?? "default-span",
			tags: maximMetadata?.spanTags,
		});

		return { maximMetadata, trace, session, span, promptMessages };
	}

	/**
	 * Executes a text or object generation call with Maxim tracing and logging.
	 *
	 * This method is called internally by generateText and generateObject, and logs the generation
	 * result, errors, and relevant metadata to Maxim.
	 *
	 * @param options - The call options for the model invocation.
	 * @returns The result of the underlying model's doGenerate call.
	 */
	async doGenerate(options: LanguageModelV1CallOptions) {
		// Parse prompt messages first to detect tool calls
		const promptMessages = parsePromptMessages(options.prompt);
		const { maximMetadata, trace, span } = this.setupLogging(options, promptMessages);
		let generation: Generation | undefined = undefined;
		let response: Awaited<ReturnType<LanguageModelV1["doGenerate"]>> | undefined = undefined;
		let hasToolCallsInResponse = false;

		try {
			generation = span.generation({
				id: uuid(),
				name: maximMetadata?.generationName ?? "default-generation",
				provider: determineProvider(this.model.provider),
				model: this.modelId,
				messages: promptMessages,
				modelParameters: extractModelParameters(options),
				tags: maximMetadata?.generationTags,
			});

			if (promptMessages.length > 0) {
				const toolCalls = promptMessages.filter((msg) => msg.role === "tool");
				for (const toolCall of toolCalls) {
					const tc = toolCall as unknown as CompletionRequest;
					if (tc.tool_call_id && typeof tc.content === "string") {
						this.logger.toolCallResult(tc.tool_call_id, tc.content);
					}
				}
			}

			// Calling the original doGenerate function
			response = await this.model.doGenerate(options);

			// Check if response has tool calls - in v1, tool calls are in rawResponse.body.choices
			const choices = (response.rawResponse as any)?.body?.choices ?? [];
			if (Array.isArray(choices)) {
				hasToolCallsInResponse = choices.some(
					(choice: any) => choice.message?.tool_calls && Array.isArray(choice.message.tool_calls) && choice.message.tool_calls.length > 0,
				);
			}

			if (hasToolCallsInResponse) {
				// Mark that we're in a tool-call sequence
				this.isInToolCallSequence = true;
			}

			const res = convertDoGenerateResultToChatCompletionResult(response);
			generation.result(res);
			generation.end();

			return response;
		} catch (error) {
			if (generation) {
				generation.error({
					message: (error as Error).message,
				});
				generation.end();
			}

			// Log error details
			console.error("[MaximSDK] doGenerate failed:", error);

			throw error;
		} finally {
			span.end();

			// End trace if:
			// 1. User explicitly provided traceId (they manage it) - but don't reset state
			// 2. OR response has no tool calls (sequence is complete or single call)
			const shouldEndTrace = maximMetadata?.traceId || !hasToolCallsInResponse;

			if (shouldEndTrace) {
				// Reset state when ending trace (only if user didn't provide traceId)
				if (!maximMetadata?.traceId) {
					this.currentTraceId = null;
					this.currentTrace = null;
					this.isInToolCallSequence = false;
					trace.end();
				}
			}
		}
	}

	/**
	 * Executes a streaming generation call with Maxim tracing and logging.
	 *
	 * This method is called internally by streamText and streamObject, and logs the streaming
	 * result, errors, and relevant metadata to Maxim.
	 *
	 * @param options - The call options for the model invocation.
	 * @returns The result of the underlying model's doStream call, with a wrapped stream.
	 */
	async doStream(options: LanguageModelV1CallOptions) {
		// Parse prompt messages first to detect tool calls
		const promptMessages = parsePromptMessages(options.prompt);
		const { maximMetadata, trace, span } = this.setupLogging(options, promptMessages);
		let generation: Generation | undefined = undefined;
		let hasToolCallsInResponse = false;
		// Capture 'this' reference for use inside the stream
		const wrapperInstance = this;

		try {
			// Calling the original doStream method
			const startTime = performance.now();
			const response = await this.model.doStream(options);
			const modelProvider = determineProvider(this.model.provider);
			const modelId = this.modelId;

			generation = span.generation({
				id: uuid(),
				name: maximMetadata?.generationName ?? "default-generation",
				provider: modelProvider,
				model: modelId,
				modelParameters: extractModelParameters(options),
				messages: promptMessages,
			});

			// going through the original stream to collect chunks and pass them without modifications to the stream
			const chunks: LanguageModelV1StreamPart[] = [];
			const firstToken: LanguageFirstTokenModel = {
				received: false,
				time: null,
			};
			const stream = new ReadableStream<LanguageModelV1StreamPart>({
				async start(controller) {
					try {
						const reader = response.stream.getReader();

						while (true) {
							const { done, value } = await reader.read();

							if (done) {
								// Stream is done, now process before closing
								try {
									// Check if we have tool calls in the stream
									hasToolCallsInResponse = chunks.some((chunk) => chunk.type === "tool-call" || chunk.type === "tool-call-delta");

									if (hasToolCallsInResponse) {
										// Mark that we're in a tool-call sequence
										wrapperInstance.isInToolCallSequence = true;
									}

									if (firstToken.received && firstToken.time) {
										trace.addMetric("time_to_first_token (in ms)", firstToken.time - startTime);
										firstToken.received = false;
										firstToken.time = null;
									}
									const endTime = performance.now();
									const textChunks = chunks.filter((chunk) => chunk.type === "text-delta" || chunk.type === "tool-call-delta");
									trace.addMetric("tokens_per_second", textChunks.length / ((endTime - startTime) / 1000));
									if (generation) processStream(chunks, span, trace, generation, modelId, maximMetadata);

									if (promptMessages.length > 0) {
										const toolCalls = promptMessages.filter((msg) => msg.role === "tool");
										for (const toolCall of toolCalls) {
											const tc = toolCall as unknown as CompletionRequest;
											if (tc.tool_call_id && typeof tc.content === "string") {
												wrapperInstance.logger.toolCallResult(tc.tool_call_id, tc.content);
											}
										}
									}

									// Handle trace ending after stream processing
									// End trace if:
									// 1. User explicitly provided traceId (they manage it) - but don't reset state
									// 2. OR response has no tool calls (sequence is complete or single call)
									const shouldEndTrace = maximMetadata?.traceId || !hasToolCallsInResponse;

									if (shouldEndTrace) {
										// Reset state when ending trace (only if user didn't provide traceId)
										if (!maximMetadata?.traceId) {
											wrapperInstance.currentTraceId = null;
											wrapperInstance.currentTrace = null;
											wrapperInstance.isInToolCallSequence = false;
											trace.end();
										}
									}
								} catch (error) {
									console.error("[MaximSDK] Processing failed:", error);
									if (generation) {
										generation.error({
											message: (error as Error).message,
										});
										generation.end();
									}
								}

								// Now close the stream
								controller.close();
								break;
							}

							// Only mark first token when we receive an actual text-delta or tool-call-delta chunk
							if (!firstToken.received && (value.type === "text-delta" || value.type === "tool-call-delta")) {
								firstToken.received = true;
								firstToken.time = performance.now();
							}

							// Collect chunk and pass it through
							chunks.push(value);
							controller.enqueue(value);
						}
					} catch (error) {
						controller.error(error);
						if (generation) {
							generation.error({
								message: (error as Error).message,
							});
							generation.end();
						}
					}
				},
			});

			// Return response with the logging stream - user gets real-time data without additional delay
			return {
				...response,
				stream: stream,
			};
		} catch (error) {
			if (generation) {
				generation.error({
					message: (error as Error).message,
				});
				generation.end();
			}

			// Log error details
			console.error("[MaximSDK] doStream failed:", error);

			throw error;
		} finally {
			// Note: For streaming, span ending happens in processStream, and trace ending
			// is handled in the stream completion handler above (because hasToolCallsInResponse
			// is set asynchronously). We don't end the trace here.
		}
	}

	/**
	 * Returns the default object generation mode of the wrapped model.
	 *
	 * @returns The default object generation mode.
	 */
	get defaultObjectGenerationMode() {
		return this.model.defaultObjectGenerationMode;
	}

	/**
	 * Returns the model ID of the wrapped model.
	 *
	 * @returns The model ID.
	 */
	get modelId() {
		return this.model.modelId;
	}

	/**
	 * Returns the provider name of the wrapped model.
	 *
	 * @returns The provider name.
	 */
	get provider() {
		return this.model.provider;
	}

	/**
	 * Returns the specification version of the wrapped model.
	 *
	 * @returns The specification version.
	 */
	get specificationVersion() {
		return this.model.specificationVersion;
	}

	/**
	 * Indicates whether the wrapped model supports image URLs.
	 *
	 * @returns True if image URLs are supported, false otherwise.
	 */
	get supportsImageUrls() {
		return this.model.supportsImageUrls;
	}

	/**
	 * Indicates whether the wrapped model supports structured outputs.
	 *
	 * @returns True if structured outputs are supported, false otherwise.
	 */
	get supportsStructuredOutputs() {
		return this.model.supportsStructuredOutputs;
	}

	/**
	 * Indicates whether the wrapped model supports URL input.
	 *
	 * @returns True if URL input is supported, false otherwise.
	 */
	get supportsUrl() {
		return this.model.supportsUrl;
	}
}
