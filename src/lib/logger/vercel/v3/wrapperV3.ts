import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "ai-sdk-provider-v3";
import { MaximLogger } from "../../logger";
import { determineProvider, extractMaximMetadataFromOptions, extractModelParameters } from "./../utils";
import { Generation, Session, Trace } from "../../components";
import { v4 as uuid } from "uuid";
import { ChatCompletionMessage, CompletionRequest } from "src/lib/models/prompt";
import { convertDoGenerateResultToChatCompletionResultV3, parsePromptMessagesV3, processStreamV3 } from "./utils";
import { LanguageFirstTokenModel } from "../types";

export class MaximAISDKWrapperV3 implements LanguageModelV3 {
	// Internal state to track trace across multiple doGenerate calls in a tool-call sequence
	private currentTraceId: string | null = null;
	private currentTrace: Trace | null = null;
	private currentSession: Session | null = null;
	private isInToolCallSequence: boolean = false;
	// Track attachments that have been added to prevent duplicates across multiple doGenerate calls
	// We use a hash of the file data to identify duplicates, since attachment IDs are regenerated each time
	private addedAttachmentHashes: Set<string> = new Set();

	/**
	 * @constructor
	 * Creates a new MaximAISDKWrapper instance.
	 *
	 * @param model - The Vercel AI SDK language model instance to wrap.
	 * @param logger - The MaximLogger instance to use for tracing and logging.
	 */
	constructor(
		private model: LanguageModelV3,
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
	private setupLogging(options: LanguageModelV3CallOptions, promptMessages: Array<CompletionRequest | ChatCompletionMessage>) {
		// Extracting the maxim object from `providerOptions`
		const maximMetadata = extractMaximMetadataFromOptions(options.providerOptions);

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

		const span = trace.span({
			id: maximMetadata?.spanId ?? uuid(),
			name: maximMetadata?.spanName ?? "default-span",
			tags: maximMetadata?.spanTags,
		});

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
	async doGenerate(options: LanguageModelV3CallOptions) {
		// Parse prompt messages first to detect tool calls and extract attachments
		const { messages: promptMessages, attachments: fileAttachments } = parsePromptMessagesV3(options.prompt);
		const { maximMetadata, trace, span } = this.setupLogging(options, promptMessages);
		let generation: Generation | undefined = undefined;
		let response: Awaited<ReturnType<LanguageModelV3["doGenerate"]>> | undefined = undefined;
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

			// Add file attachments to both generation and trace, avoiding duplicates
			// We hash the file data to identify duplicates across multiple doGenerate calls
			for (const attachment of fileAttachments) {
				let identifier: string;
				
				if (attachment.type === "fileData") {
					// Create a simple hash of the file data to detect duplicates
					identifier = this.hashBuffer(attachment.data);
				} else {
					// For URL and file path attachments, use the URL/path as the identifier
					identifier = attachment.type === "url" ? attachment.url : attachment.path;
				}
				
				if (!this.addedAttachmentHashes.has(identifier)) {
					generation.addAttachment({
						...attachment,
						id: uuid(),
					});
					trace.addAttachment({
						...attachment,
						id: uuid(),
					});
					this.addedAttachmentHashes.add(identifier);
				}
			}

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

			// Check if response has tool calls - if so, we're in a tool-call sequence
			hasToolCallsInResponse = response.content?.some((content) => content.type === "tool-call") ?? false;

			if (hasToolCallsInResponse) {
				// Mark that we're in a tool-call sequence
				this.isInToolCallSequence = true;
			}

			// Create ToolCall entities for any tool calls in the response
			if (response.content) {
				for (const content of response.content) {
					if (content.type === "tool-call") {
						const toolCallId = content.toolCallId;
						const toolName = content.toolName;
						const toolInput = typeof content.input === "string" ? content.input : JSON.stringify(content.input);

						span.toolCall({
							id: toolCallId,
							name: toolName,
							description: toolName,
							args: toolInput,
						});
					}
				}
			}

			const res = convertDoGenerateResultToChatCompletionResultV3(response);
			generation.result(res);

			return response;
		} catch (error) {
			if (generation) {
				generation.error({
					message: (error as Error).message,
				});
			}

			// Log error details
			console.error("[MaximSDK] doGenerate failed:", error);

			throw error;
		} finally {
			span.end();

			if (!hasToolCallsInResponse) {
				this.addedAttachmentHashes.clear();
			}
			this.currentTraceId = null;
			this.currentTrace = null;
			this.isInToolCallSequence = false;
			trace.end();
			await this.logger.flush();
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
	async doStream(options: LanguageModelV3CallOptions) {
		// Parse prompt messages first to detect tool calls and extract attachments
		const { messages: promptMessages, attachments: fileAttachments } = parsePromptMessagesV3(options.prompt);
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

			// Add file attachments to both generation and trace, avoiding duplicates
			// We hash the file data to identify duplicates across multiple doGenerate calls
			for (const attachment of fileAttachments) {
				let identifier: string;
				
				if (attachment.type === "fileData") {
					// Create a simple hash of the file data to detect duplicates
					identifier = wrapperInstance.hashBuffer(attachment.data);
				} else {
					// For URL and file path attachments, use the URL/path as the identifier
					identifier = attachment.type === "url" ? attachment.url : attachment.path;
				}
				
				if (!wrapperInstance.addedAttachmentHashes.has(identifier)) {
					generation.addAttachment({
						...attachment,
						id: uuid(),
					});
					trace.addAttachment({
						...attachment,
						id: uuid(),
					});
					wrapperInstance.addedAttachmentHashes.add(identifier);
				}
			}

			// going through the original stream to collect chunks and pass them without modifications to the stream
			const chunks: LanguageModelV3StreamPart[] = [];
			const firstToken: LanguageFirstTokenModel = {
				received: false,
				time: null,
			};

			const stream = new ReadableStream<LanguageModelV3StreamPart>({
				async start(controller) {
					try {
						const reader = response.stream.getReader();

						while (true) {
							const { done, value } = await reader.read();

							if (done) {
								// Stream is done, now process before closing
								try {
									// Check if we have tool calls in the stream
									hasToolCallsInResponse = chunks.some((chunk) => chunk.type === "tool-call");

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
									const textChunks = chunks.filter((chunk) => chunk.type === "text-delta" || chunk.type === "tool-input-delta");
									trace.addMetric("tokens_per_second", textChunks.length / ((endTime - startTime) / 1000));
									if (generation) processStreamV3(chunks, span, trace, generation, modelId, maximMetadata);

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
									if (!hasToolCallsInResponse) {
										// Reset attachment tracking when sequence is complete
										wrapperInstance.addedAttachmentHashes.clear();
									}
									wrapperInstance.currentTraceId = null;
									wrapperInstance.currentTrace = null;
									wrapperInstance.isInToolCallSequence = false;
									trace.end();

									// Flush logs after processStreamV3 and tool-result logging complete
									await wrapperInstance.logger.flush();
								} catch (error) {
									console.error("[MaximSDK] Processing failed:", error);
									if (generation) {
										generation.error({
											message: (error as Error).message,
										});
										generation.end();
									}
									// Flush logs even on error
									await wrapperInstance.logger.flush();
								}

								// Now close the stream
								controller.close();
								break;
							}

							if (!firstToken.received && (value.type === "text-delta" || value.type === "tool-input-delta")) {
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
						// Flush logs on stream error
						await wrapperInstance.logger.flush();
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

			// Flush logs before throwing error
			await this.logger.flush();

			throw error;
		} finally {
			// End trace if:
			// 1. User explicitly provided traceId (they manage it) - but don't reset state
			// 2. OR response has no tool calls (sequence is complete or single call)

			// Reset state when ending trace (only if user didn't provide traceId)
			// Note: hasToolCallsInResponse is not available here, so we check isInToolCallSequence
			if (!this.isInToolCallSequence) {
				// Reset attachment tracking when sequence is complete
				this.addedAttachmentHashes.clear();
			}
			this.currentTraceId = null;
			this.currentTrace = null;
			this.isInToolCallSequence = false;
			trace.end();
		}
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
	 * Supported URL patterns by media type for the provider.
	 *
	 * @returns A map of supported URL patterns by media type (as a promise or a plain object).
	 */
	get supportedUrls() {
		return this.model.supportedUrls;
	}

	/**
	 * Creates a simple hash of a buffer for duplicate detection.
	 * Uses a combination of buffer length and a sample of the data.
	 *
	 * @private
	 * @param buffer - The buffer to hash
	 * @returns A hash string identifying the buffer
	 */
	private hashBuffer(buffer: Buffer): string {
		// Use length and first/last bytes for a simple but effective hash
		// This is sufficient for duplicate detection without being too expensive
		const length = buffer.length;
		const firstBytes = buffer.slice(0, Math.min(16, length)).toString("hex");
		const lastBytes = length > 16 ? buffer.slice(-16).toString("hex") : "";
		const middleBytes = length > 32 ? buffer.slice(Math.floor(length / 2) - 8, Math.floor(length / 2) + 8).toString("hex") : "";
		return `${length}:${firstBytes}:${middleBytes}:${lastBytes}`;
	}
}
