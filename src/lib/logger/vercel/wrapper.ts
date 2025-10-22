import type { LanguageModelV1, LanguageModelV1CallOptions, LanguageModelV1StreamPart } from "ai-sdk-provider-v1";
import type { LanguageModelV2 } from "ai-sdk-provider-v2";
import { MaximLogger } from "../logger";
import { v4 as uuid } from "uuid";
import {
	convertDoGenerateResultToChatCompletionResult,
	determineProvider,
	extractMaximMetadataFromOptions,
	extractModelParameters,
	parsePromptMessages,
	processStream,
} from "./utils";
import { Generation, Session } from "../components";
import { MaximAISDKWrapperV2 } from "./wrapperV2";

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
	 * @returns An object containing maximMetadata, trace, session, span, and promptMessages.
	 */
	private setupLogging(options: LanguageModelV1CallOptions) {
		// Extracting the maxim object from `providerOptions`
		const maximMetadata = extractMaximMetadataFromOptions(options.providerMetadata);

		// Parsing the ai-sdk prompt messages to maxim prompt messages
		const promptMessages = parsePromptMessages(options.prompt);
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
	async doStream(options: LanguageModelV1CallOptions) {
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
									if (generation) processStream(chunks, span, trace, generation, modelId, maximMetadata);
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
