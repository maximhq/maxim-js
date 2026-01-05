import type OpenAI from "openai";
import { v4 as uuid } from "uuid";
import type { MaximLogger } from "../logger";
import type { Generation, Trace } from "../components";
import { OpenAIUtils } from "./utils";

type ChatCompletionCreateParams = OpenAI.Chat.Completions.ChatCompletionCreateParams;
type ChatCompletionCreateParamsStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
type ChatCompletionCreateParamsNonStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionChunk = OpenAI.Chat.Completions.ChatCompletionChunk;
type ChatCompletionMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Stream<T> = AsyncIterable<T>;

/**
 * Information about a tool call extracted from messages.
 */
interface ExtractedToolCall {
	id: string;
	name: string;
	arguments: string;
	result: string;
}

/**
 * Extract tool calls and their results from messages.
 * Matches assistant tool_calls with corresponding tool messages.
 */
function extractToolCalls(messages: ChatCompletionMessageParam[]): ExtractedToolCall[] {
	const toolCalls: ExtractedToolCall[] = [];

	// Map of tool_call_id to tool call info from assistant messages
	const toolCallMap = new Map<string, { name: string; arguments: string }>();

	// First pass: collect tool calls from assistant messages
	for (const msg of messages) {
		if (msg.role === "assistant" && "tool_calls" in msg && msg.tool_calls) {
			for (const tc of msg.tool_calls) {
				if (tc.type === "function" && "function" in tc && tc.function) {
					toolCallMap.set(tc.id, {
						name: tc.function.name,
						arguments: tc.function.arguments,
					});
				}
			}
		}
	}

	// Second pass: match tool messages with their corresponding tool calls
	for (const msg of messages) {
		if (msg.role === "tool" && "tool_call_id" in msg) {
			const toolCallInfo = toolCallMap.get(msg.tool_call_id);
			if (toolCallInfo) {
				toolCalls.push({
					id: msg.tool_call_id,
					name: toolCallInfo.name,
					arguments: toolCallInfo.arguments,
					result: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
				});
			}
		}
	}

	return toolCalls;
}

/**
 * Async stream wrapper that logs to Maxim when the stream completes.
 */
class AsyncStreamWrapper implements AsyncIterable<ChatCompletionChunk> {
	private chunks: ChatCompletionChunk[] = [];
	private consumed = false;
	private startTime: number;
	private firstTokenTime: number | null = null;

	constructor(
		private stream: Stream<ChatCompletionChunk>,
		private generation: Generation | null,
		private trace: Trace | null,
		private isLocalTrace: boolean,
	) {
		this.startTime = performance.now();
	}

	async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
		try {
			for await (const chunk of this.stream) {
				// Track time to first token
				if (this.firstTokenTime === null && this.hasContent(chunk)) {
					this.firstTokenTime = performance.now();
				}

				this.chunks.push(chunk);
				yield chunk;
			}
		} finally {
			if (!this.consumed) {
				this.consumed = true;
				this.finalizeLogging();
			}
		}
	}

	/**
	 * Check if the chunk has actual content (not just metadata).
	 */
	private hasContent(chunk: ChatCompletionChunk): boolean {
		for (const choice of chunk.choices) {
			if (choice.delta?.content || choice.delta?.tool_calls) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Get completion tokens from the usage field of the last chunk.
	 * The usage field is present when stream_options.include_usage is true.
	 */
	private getCompletionTokens(): number | null {
		for (let i = this.chunks.length - 1; i >= 0; i--) {
			const chunk = this.chunks[i];
			if (chunk.usage?.completion_tokens !== undefined) {
				return chunk.usage.completion_tokens;
			}
		}
		return null;
	}

	private finalizeLogging(): void {
		const endTime = performance.now();

		try {
			if (this.generation && this.chunks.length > 0) {
				const combinedResponse = OpenAIUtils.parseCompletionFromChunks(this.chunks);
				this.generation.result(combinedResponse);

				if (this.firstTokenTime !== null) {
					const ttftMs = this.firstTokenTime - this.startTime;
					this.generation.addMetric("ttft_ms", ttftMs);

					const completionTokens = this.getCompletionTokens();
					const generationDurationMs = endTime - this.firstTokenTime;
					if (generationDurationMs > 0 && completionTokens !== null && generationDurationMs > 0 && completionTokens > 0) {
						const tps = (completionTokens / generationDurationMs) * 1000;
						this.generation.addMetric("tokens_per_second", tps);
					}
				}
			}

			if (this.isLocalTrace && this.trace) {
				const combinedText = OpenAIUtils.extractTextFromChunks(this.chunks);
				this.trace.output(combinedText);
				this.trace.end();
			}
		} catch (e) {
			if (this.generation) {
				this.generation.error({ message: e instanceof Error ? e.message : String(e) });
			}
			console.warn(`[MaximSDK][MaximOpenAIChatCompletions] Error in logging stream completion: ${e}`);
		}
	}
}

/**
 * Options for the MaximOpenAIChatCompletions create method.
 */
export type MaximChatCompletionOptions = {
	/**
	 * Custom trace ID for this completion.
	 * If not provided, a new trace will be created.
	 */
	traceId?: string;
	/**
	 * Name for the generation.
	 */
	generationName?: string;
};

/**
 * Wrapped OpenAI chat completions that automatically logs to Maxim.
 */
export class MaximOpenAIChatCompletions {
	constructor(
		private client: OpenAI,
		private logger: MaximLogger,
	) {}

	/**
	 * Creates a chat completion with automatic Maxim logging.
	 *
	 * @example
	 * ```typescript
	 * // Non-streaming
	 * const response = await client.chat.completions.create({
	 *   model: 'gpt-4',
	 *   messages: [{ role: 'user', content: 'Hello!' }]
	 * });
	 *
	 * // Streaming
	 * const stream = await client.chat.completions.create({
	 *   model: 'gpt-4',
	 *   messages: [{ role: 'user', content: 'Hello!' }],
	 *   stream: true
	 * });
	 * for await (const chunk of stream) {
	 *   process.stdout.write(chunk.choices[0]?.delta?.content || '');
	 * }
	 * ```
	 */
	async create(params: ChatCompletionCreateParamsStreaming, options?: OpenAI.RequestOptions): Promise<AsyncIterable<ChatCompletionChunk>>;
	async create(params: ChatCompletionCreateParamsNonStreaming, options?: OpenAI.RequestOptions): Promise<ChatCompletion>;
	async create(
		params: ChatCompletionCreateParams,
		options?: OpenAI.RequestOptions,
	): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>;
	async create(
		params: ChatCompletionCreateParams,
		options?: OpenAI.RequestOptions,
	): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
		// Extract Maxim metadata from extra_headers
		const extraHeaders = options?.headers as Record<string, string> | undefined;
		let traceId: string | undefined;
		let generationName: string | undefined;
		let sessionId: string | undefined;
		let traceTags: string | undefined;

		if (extraHeaders) {
			traceId = extraHeaders["x-maxim-trace-id"] || undefined;
			generationName = extraHeaders["x-maxim-generation-name"] || undefined;
			sessionId = extraHeaders["x-maxim-session-id"] || undefined;
			traceTags = extraHeaders["x-maxim-trace-tags"] || undefined;
		}

		const isLocalTrace = traceId === undefined;
		const finalTraceId = traceId || uuid();
		const isStreaming = params.stream === true;

		let generation: Generation | null = null;
		let trace: Trace | null = null;

		// Add stream_options with include_usage for streaming if not present
		const modifiedParams = { ...params };
		if (isStreaming) {
			if (!modifiedParams.stream_options) {
				modifiedParams.stream_options = { include_usage: true };
			} else if (!modifiedParams.stream_options.include_usage) {
				modifiedParams.stream_options = { ...modifiedParams.stream_options, include_usage: true };
			}
		}

		try {
			// Create trace and generation
			trace = this.logger.trace({ id: finalTraceId, sessionId });

			if (isStreaming) {
				trace.addTag("stream", "true");
			}
			if (traceTags) {
				try {
					const parsedTags = JSON.parse(traceTags) as Record<string, string>;
					for (const [key, value] of Object.entries(parsedTags)) {
						trace.addTag(key, value);
					}
				} catch (error) {
					console.warn(`[MaximSDK][MaximOpenAIChatCompletions] Error in parsing trace tags: ${error}`);
				}
			}

			// Log any tool calls present in the messages (from previous interactions)
			const extractedToolCalls = extractToolCalls(params.messages);
			for (const tc of extractedToolCalls) {
				const toolCall = trace.toolCall({
					id: tc.id,
					name: tc.name,
					description: `Tool call: ${tc.name}`,
					args: tc.arguments,
				});
				toolCall.result(tc.result);
			}

			const messages = OpenAIUtils.parseMessageParam(params.messages);
			const modelParams = OpenAIUtils.getModelParams(params);

			generation = trace.generation({
				id: uuid(),
				model: params.model,
				provider: "openai",
				name: generationName,
				modelParameters: modelParams,
				messages: messages,
			});
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIChatCompletions] Error in setting up logging: ${e}`);
		}

		try {
			// Call the original OpenAI API
			const response = await this.client.chat.completions.create(modifiedParams as any, options);

			if (isStreaming) {
				// For streaming responses, return a wrapped stream that handles logging
				// The OpenAI SDK returns an AsyncIterable stream when stream: true
				return new AsyncStreamWrapper(response as unknown as AsyncIterable<ChatCompletionChunk>, generation, trace, isLocalTrace);
			} else {
				// For non-streaming responses, log immediately
				const completion = response as ChatCompletion;
				try {
					if (generation) {
						const result = OpenAIUtils.parseCompletion(completion);
						generation.result(result);
					}
					if (isLocalTrace && trace) {
						const output = completion.choices[0]?.message?.content || "";
						trace.output(output);
						trace.end();
					}
				} catch (e) {
					if (generation) {
						generation.error({ message: e instanceof Error ? e.message : String(e) });
					}
					console.warn(`[MaximSDK][MaximOpenAIChatCompletions] Error in logging generation: ${e}`);
				}
				return completion;
			}
		} catch (e) {
			// Log error if generation was created
			if (generation) {
				generation.error({ message: e instanceof Error ? e.message : String(e) });
			}
			console.warn(`[MaximSDK][MaximOpenAIChatCompletions] Error in generating content: ${e}`);
			throw e;
		}
	}
}
