import type OpenAI from "openai";
import { v4 as uuid } from "uuid";
import type { MaximLogger } from "../logger";
import type { Generation, Trace } from "../components";
import { OpenAIUtils } from "./utils";

type ResponseCreateParamsNonStreaming = OpenAI.Responses.ResponseCreateParamsNonStreaming;
type ResponseCreateParamsStreaming = OpenAI.Responses.ResponseCreateParamsStreaming;
type Response = OpenAI.Responses.Response;

/**
 * Information about a tool call extracted from Responses API input/output.
 */
interface ExtractedToolCall {
	id: string;
	name: string;
	arguments: string;
	result?: string;
}

/**
 * Extract tool calls and their results from Responses API input.
 * Matches function_call items with corresponding function_call_output items.
 */
function extractToolCallsFromInput(input: any): ExtractedToolCall[] {
	if (!input || !Array.isArray(input)) {
		return [];
	}

	const toolCalls: ExtractedToolCall[] = [];
	const toolCallMap = new Map<string, { name: string; arguments: string }>();

	// First pass: collect function_call items
	for (const item of input) {
		if (!item || typeof item !== "object") continue;

		if (item.type === "function_call" && item.call_id) {
			toolCallMap.set(item.call_id, {
				name: item.name || "unknown",
				arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {}),
			});
		}
	}

	// Second pass: match function_call_output items with their calls
	for (const item of input) {
		if (!item || typeof item !== "object") continue;

		if (item.type === "function_call_output" && item.call_id) {
			const callInfo = toolCallMap.get(item.call_id);
			if (callInfo) {
				toolCalls.push({
					id: item.call_id,
					name: callInfo.name,
					arguments: callInfo.arguments,
					result: typeof item.output === "string" ? item.output : JSON.stringify(item.output || ""),
				});
				// Remove from map to avoid duplicates
				toolCallMap.delete(item.call_id);
			}
		}
	}

	// Add any remaining tool calls without results (pending calls)
	for (const [callId, callInfo] of toolCallMap) {
		toolCalls.push({
			id: callId,
			name: callInfo.name,
			arguments: callInfo.arguments,
		});
	}

	return toolCalls;
}

/**
 * Extract function calls from Responses API output.
 */
function extractToolCallsFromOutput(response: Response): ExtractedToolCall[] {
	const toolCalls: ExtractedToolCall[] = [];

	if (!response.output || !Array.isArray(response.output)) {
		return toolCalls;
	}

	for (const item of response.output) {
		if (!item || typeof item !== "object") continue;

		if (item.type === "function_call") {
			const funcCall = item as OpenAI.Responses.ResponseFunctionToolCall;
			toolCalls.push({
				id: funcCall.call_id || uuid(),
				name: funcCall.name || "unknown",
				arguments: typeof funcCall.arguments === "string" ? funcCall.arguments : JSON.stringify(funcCall.arguments || {}),
			});
		}
	}

	return toolCalls;
}

/**
 * Log extracted tool calls to a trace.
 */
function logToolCallsToTrace(trace: Trace, toolCalls: ExtractedToolCall[]): void {
	for (const tc of toolCalls) {
		const toolCall = trace.toolCall({
			id: tc.id,
			name: tc.name,
			description: `Tool call: ${tc.name}`,
			args: tc.arguments,
		});
		if (tc.result !== undefined) {
			toolCall.result(tc.result);
		}
	}
}

/**
 * Async stream wrapper that logs to Maxim when the stream completes.
 * Wraps the OpenAI ResponseStream and captures the final response for logging.
 * Also tracks streaming metrics like time to first token and tokens per second.
 */
class ResponseStreamWrapper implements AsyncIterable<OpenAI.Responses.ResponseStreamEvent> {
	private capturedResponse: Response | null = null;
	private consumed = false;
	private startTime: number;
	private firstTokenTime: number | null = null;
	private endTime: number | null = null;

	constructor(
		private streamManager: ReturnType<OpenAI["responses"]["stream"]>,
		private generation: Generation | null,
		private trace: Trace | null,
		private isLocalTrace: boolean,
	) {
		this.startTime = performance.now();
	}

	async *[Symbol.asyncIterator](): AsyncIterator<OpenAI.Responses.ResponseStreamEvent> {
		try {
			for await (const event of this.streamManager) {
				// Track time to first content token
				if (this.firstTokenTime === null && this.hasContent(event)) {
					this.firstTokenTime = performance.now();
				}

				// Capture the response from the completed event
				if (event.type === "response.completed") {
					this.capturedResponse = (event as any).response as Response;
				}

				yield event;
			}
		} finally {
			this.endTime = performance.now();
			if (!this.consumed) {
				this.consumed = true;
				// Use async finalization to await the finalResponse promise if needed
				this.finalizeLoggingAsync().catch((e) => {
					console.warn(`[MaximSDK][MaximOpenAIResponses] Error in async finalization: ${e}`);
				});
			}
		}
	}

	/**
	 * Check if the event has actual content (text delta).
	 */
	private hasContent(event: OpenAI.Responses.ResponseStreamEvent): boolean {
		// Text delta events indicate actual content being generated
		if (event.type === "response.output_text.delta") {
			return true;
		}
		// Also consider content part added events
		if (event.type === "response.content_part.added") {
			return true;
		}
		return false;
	}

	/**
	 * Get output tokens from the final response usage.
	 */
	private getOutputTokens(response: Response | null): number | null {
		if (response?.usage) {
			return response.usage.output_tokens ?? null;
		}
		return null;
	}

	private async finalizeLoggingAsync(): Promise<void> {
		const endTime = this.endTime ?? performance.now();

		try {
			// Try to get the final response - prefer captured from event, fallback to SDK method
			let finalResponse = this.capturedResponse;

			if (!finalResponse) {
				try {
					// The OpenAI SDK's ResponseStream.finalResponse() returns a Promise
					finalResponse = await this.streamManager.finalResponse();
				} catch {
					// Best-effort - stream may have ended without a response
				}
			}

			if (finalResponse !== null) {
				try {
					if (this.generation) {
						this.generation.result(finalResponse);

						// Add streaming metrics
						if (this.firstTokenTime !== null) {
							const ttftMs = this.firstTokenTime - this.startTime;
							this.generation.addMetric("ttft_ms", ttftMs);

							const outputTokens = this.getOutputTokens(finalResponse);
							const generationDurationMs = endTime - this.firstTokenTime;
							if (generationDurationMs > 0 && outputTokens !== null && outputTokens > 0) {
								const tps = (outputTokens / generationDurationMs) * 1000;
								this.generation.addMetric("tokens_per_second", tps);
							}
						}
					}

					// Log tool calls from response output (new tool calls made by the model)
					if (this.trace) {
						const outputToolCalls = extractToolCallsFromOutput(finalResponse);
						logToolCallsToTrace(this.trace, outputToolCalls);
						try {
							const outputText = OpenAIUtils.extractResponsesOutputText(finalResponse);
							if (typeof outputText === "string") {
								this.trace.output(outputText);
							}
						} catch {}
					}

					if (this.isLocalTrace && this.trace) {
						this.trace.end();
					}
				} catch (e) {
					if (this.generation) {
						this.generation.error({ message: e instanceof Error ? e.message : String(e) });
					}
					console.warn(`[MaximSDK][MaximOpenAIResponses] Error in logging streamed generation: ${e}`);
				}
			} else {
				// No final response available, still close the trace if local
				if (this.isLocalTrace && this.trace) {
					this.trace.end();
				}
			}
		} catch (e) {
			if (this.generation) {
				this.generation.error({ message: e instanceof Error ? e.message : String(e) });
			}
			console.warn(`[MaximSDK][MaximOpenAIResponses] Error in finalizing stream logging: ${e}`);
		}
	}
}

/**
 * Wrapped OpenAI Responses that automatically logs to Maxim.
 *
 * @example
 * ```typescript
 * const client = new MaximOpenAIClient(openai, logger);
 *
 * // Non-streaming
 * const response = await client.responses.create({
 *   model: "gpt-4.1",
 *   input: "Hello, world!"
 * });
 *
 * // Streaming
 * const stream = await client.responses.stream({
 *   model: "gpt-4.1",
 *   input: "Tell me a story"
 * });
 * for await (const event of stream) {
 *   // process events
 * }
 * // Logging happens automatically when stream completes
 * ```
 */
export class MaximOpenAIResponses {
	constructor(
		private client: OpenAI,
		private logger: MaximLogger,
	) {}

	/**
	 * Start a trace and generation for a Responses API call.
	 */
	private startTraceAndGeneration(options: {
		extraHeaders?: Record<string, string>;
		model?: string;
		messages: ReturnType<typeof OpenAIUtils.parseResponsesInputToMessages>;
		modelParameters: Record<string, any>;
		isStreaming?: boolean;
		input?: any;
	}): {
		isLocalTrace: boolean;
		trace: Trace | null;
		generation: Generation | null;
	} {
		const { extraHeaders, model, messages, modelParameters, isStreaming, input } = options;

		let traceId: string | undefined;
		let generationName: string | undefined;
		let sessionId: string | undefined;
		let traceTags: string | undefined;

		if (extraHeaders) {
			traceId = extraHeaders["maxim-trace-id"] || undefined;
			generationName = extraHeaders["maxim-generation-name"] || undefined;
			sessionId = extraHeaders["maxim-session-id"] || undefined;
			traceTags = extraHeaders["maxim-trace-tags"] || undefined;
		}

		const isLocalTrace = traceId === undefined;
		const finalTraceId = traceId || uuid();

		let trace: Trace | null = null;
		let generation: Generation | null = null;

		try {
			trace = this.logger.trace({ id: finalTraceId, sessionId });

			// Add stream tag if streaming
			if (isStreaming) {
				trace.addTag("stream", "true");
			}

			// Parse and add custom trace tags
			if (traceTags) {
				try {
					const parsedTags = JSON.parse(traceTags) as Record<string, string>;
					for (const [key, value] of Object.entries(parsedTags)) {
						trace.addTag(key, value);
					}
				} catch (error) {
					console.warn(`[MaximSDK][MaximOpenAIResponses] Error in parsing trace tags: ${error}`);
				}
			}

			// Log tool calls from input (previous interactions)
			if (input) {
				const inputToolCalls = extractToolCallsFromInput(input);
				logToolCallsToTrace(trace, inputToolCalls);
			}

			generation = trace.generation({
				id: uuid(),
				model: String(model || "unknown"),
				provider: "openai",
				name: generationName,
				modelParameters,
				messages,
			});
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIResponses] Error starting trace/generation: ${e}`);
		}

		return { isLocalTrace, trace, generation };
	}

	/**
	 * Creates a response with automatic Maxim logging.
	 *
	 * @example
	 * ```typescript
	 * const response = await client.responses.create({
	 *   model: "gpt-4.1",
	 *   input: "What is the meaning of life?"
	 * });
	 * ```
	 */
	async create(params: ResponseCreateParamsNonStreaming, options?: OpenAI.RequestOptions): Promise<Response> {
		const extraHeaders = options?.headers as Record<string, string> | undefined;
		const model = params.model;
		const inputValue = params.input;

		const messages = OpenAIUtils.parseResponsesInputToMessages(inputValue);
		const modelParameters = OpenAIUtils.getResponsesModelParams(params);

		const { isLocalTrace, trace, generation } = this.startTraceAndGeneration({
			extraHeaders,
			model,
			messages,
			modelParameters,
			isStreaming: false,
			input: inputValue,
		});

		let response: Response;

		try {
			response = (await this.client.responses.create(params, options)) as Response;
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIResponses] Error generating response: ${e}`);

			// Mark generation as errored if available
			if (generation) {
				generation.error({
					message: e instanceof Error ? e.message : String(e),
					type: e instanceof Error ? e.constructor.name : undefined,
				});
			}

			if (trace) {
				try {
					trace.error({
						id: uuid(),
						message: e instanceof Error ? e.message : String(e),
						type: e instanceof Error ? e.constructor.name : undefined,
					});
				} catch {}
			}

			if (isLocalTrace && trace) {
				trace.end();
			}

			throw e;
		}

		try {
			if (generation) {
				generation.result(response);
			}

			// Log tool calls from response output (new tool calls made by the model)
			if (trace) {
				const outputToolCalls = extractToolCallsFromOutput(response);
				logToolCallsToTrace(trace, outputToolCalls);
				try {
					const outputText = OpenAIUtils.extractResponsesOutputText(response);
					if (typeof outputText === "string") {
						trace.output(outputText);
					}
				} catch {}
			}

			if (isLocalTrace && trace) {
				trace.end();
			}
		} catch (e) {
			if (generation) {
				generation.error({ message: e instanceof Error ? e.message : String(e) });
			}
			console.warn(`[MaximSDK][MaximOpenAIResponses] Error in logging generation: ${e}`);
		}

		return response;
	}

	/**
	 * Creates a streaming response with automatic Maxim logging.
	 * Logging happens automatically when the stream is consumed.
	 *
	 * @example
	 * ```typescript
	 * const stream = client.responses.stream({
	 *   model: "gpt-4.1",
	 *   input: "Tell me a story"
	 * });
	 * for await (const event of stream) {
	 *   if (event.type === 'response.output_text.delta') {
	 *     process.stdout.write(event.delta);
	 *   }
	 * }
	 * // Logging happens automatically when stream completes
	 * ```
	 */
	stream(params: ResponseCreateParamsStreaming, options?: OpenAI.RequestOptions): ResponseStreamWrapper {
		const extraHeaders = options?.headers as Record<string, string> | undefined;
		const model = params.model;
		const inputValue = params.input;

		const messages = OpenAIUtils.parseResponsesInputToMessages(inputValue);
		const modelParameters = OpenAIUtils.getResponsesModelParams(params);

		const { isLocalTrace, trace, generation } = this.startTraceAndGeneration({
			extraHeaders,
			model,
			messages,
			modelParameters,
			isStreaming: true,
			input: inputValue,
		});

		let streamManager: ReturnType<OpenAI["responses"]["stream"]>;

		try {
			streamManager = this.client.responses.stream(params, options);
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIResponses] Error starting streaming response: ${e}`);

			// Mark generation as errored if available
			if (generation) {
				generation.error({
					message: e instanceof Error ? e.message : String(e),
					type: e instanceof Error ? e.constructor.name : undefined,
				});
			}

			// Ensure local trace is closed on error
			if (isLocalTrace && trace) {
				try {
					trace.error({
						id: uuid(),
						message: e instanceof Error ? e.message : String(e),
						type: e instanceof Error ? e.constructor.name : undefined,
					});
				} catch {}
				try {
					trace.end();
				} catch {}
			}

			throw e;
		}

		// Return a wrapper that delegates iteration to the underlying stream
		// but logs the final response automatically when iteration completes.
		return new ResponseStreamWrapper(streamManager, generation, trace, isLocalTrace);
	}
}
