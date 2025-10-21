import type { LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2StreamPart } from "ai-sdk-provider-v2";
import { v4 as uuid } from "uuid";
import { Generation, Session } from "../components";
import { MaximLogger } from "../logger";
import {
	convertDoGenerateResultToChatCompletionResultV2,
	determineProvider,
	extractMaximMetadataFromOptions,
	extractModelParameters,
	parsePromptMessagesV2,
	processStreamV2,
} from "./utils";

export class MaximAISDKWrapperV2 implements LanguageModelV2 {
	/**
	 * @constructor
	 * Creates a new MaximAISDKWrapper instance.
	 *
	 * @param model - The Vercel AI SDK language model instance to wrap.
	 * @param logger - The MaximLogger instance to use for tracing and logging.
	 */
	constructor(
		private model: LanguageModelV2,
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
	 * @returns An object containing maximMetadata, trace, session, span, and promptMessages.
	 */
	private setupLogging(options: LanguageModelV2CallOptions) {
		// Extracting the maxim object from `providerOptions`
		const maximMetadata = extractMaximMetadataFromOptions(options.providerOptions);

		// Parsing the ai-sdk prompt messages to maxim prompt messages
		const promptMessages = parsePromptMessagesV2(options.prompt);
		let session: Session | undefined = undefined;

		// If sessionId is passed, then create a session on Maxim. If not passed, do not create a session
		if (maximMetadata?.sessionId) {
			session = this.logger.session({
				id: maximMetadata.sessionId,
				name: maximMetadata.sessionName ?? "default-session",
				tags: maximMetadata.sessionTags,
			});
		}

		// If the user passes in a traceId, we push to the existing trace or else we create a new trace
		const trace = session
			? session.trace({
					id: maximMetadata?.traceId ?? uuid(),
					name: maximMetadata?.traceName ?? "default-trace",
					tags: maximMetadata?.traceTags,
				})
			: this.logger.trace({
					id: maximMetadata?.traceId ?? uuid(),
					name: maximMetadata?.traceName ?? "default-trace",
					tags: maximMetadata?.traceTags,
				});



		const span = trace.span({
			id: maximMetadata?.spanId ?? uuid(),
			name: maximMetadata?.spanName ?? "default-span",
			tags: maximMetadata?.spanTags,
		});

		const userMessage = promptMessages.find((msg) => msg.role === "user");
		
		const userInput = userMessage?.content;
		if (userInput) {
			if (typeof userInput === "string") {
				trace.input(userInput);
			} else {
				const userMessage = userInput[0];
				switch (userMessage.type) {
					case "text":
						trace.input(userMessage.text);
						break;
					case "image_url":
						trace.input(userMessage.image_url.url);
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
	async doGenerate(options: LanguageModelV2CallOptions) {
		const { maximMetadata, trace, span, promptMessages } = this.setupLogging(options);
		let generation: Generation | undefined = undefined;

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

			// Calling the original doGenerate function
			const response = await this.model.doGenerate(options);

			const res = convertDoGenerateResultToChatCompletionResultV2(response);
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
			if (!maximMetadata?.traceId) trace.end();
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
	async doStream(options: LanguageModelV2CallOptions) {
		const { maximMetadata, trace, span, promptMessages } = this.setupLogging(options);
		let generation: Generation | undefined = undefined;

		try {
			// Calling the original doStream method
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
			const chunks: LanguageModelV2StreamPart[] = [];
			const stream = new ReadableStream<LanguageModelV2StreamPart>({
				async start(controller) {
					try {
						const reader = response.stream.getReader();

						while (true) {
							const { done, value } = await reader.read();

							if (done) {
								// Stream is done, now process before closing
								try {
									if (generation) processStreamV2(chunks, span, trace, generation, modelId, maximMetadata);
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
			span.end();
			if (!maximMetadata?.traceId) trace.end();
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
}
