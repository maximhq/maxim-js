import {
	LanguageModelV1CallOptions,
	LanguageModelV1FunctionToolCall,
	LanguageModelV1Prompt,
	LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import { v4 as uuid } from "uuid";
import { ChatCompletionMessage, ChatCompletionResult, CompletionRequest, Generation, Span, Trace } from "../../../../index";
import { CompletionRequestContent } from "../../models/prompt";

/**
 * Determines the provider type from a given model string.
 *
 * This function inspects the model identifier and returns a type-safe provider name (such as 'openai', 'bedrock', 'anthropic', etc.) based on known substrings in the model name.
 * If no known provider is found, it defaults to 'openai'.
 *
 * @param model - The model identifier string to inspect.
 * @returns The detected provider name.
 */
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

/**
 * Extracts supported model parameters from the given language model call options.
 *
 * This function pulls out relevant generation parameters (such as temperature, maxTokens, penalties, etc.) from the provided LanguageModelV1CallOptions object, returning them in a plain object for downstream use.
 *
 * @param options - The call options containing model parameters.
 * @returns An object containing the extracted model parameters, including temperature, maxTokens, topP, topK, frequencyPenalty, stopSequences, seed, headers, presencePenalty, abortSignal, and responseFormat.
 */
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
		responseFormat: options.responseFormat,
	};
}

/**
 * Metadata options for Maxim tracing integration with Vercel AI SDK providers.
 *
 * This type allows you to attach custom metadata to sessions, traces, generations, and spans when using Maxim's tracing/logging features. These fields enable advanced tracking, naming, and tagging of AI model calls for observability and debugging.
 *
 * @property sessionId - Link your traces to a session by specifying its ID.
 * @property sessionName - Override the default session name for this trace.
 * @property sessionTags - Add custom tags to the session for filtering or grouping.
 * @property traceId - Pass in an existing trace's ID to associate this call with a specific trace.
 * @property traceName - Override the default trace name for this call.
 * @property traceTags - Add custom tags to the trace for filtering or grouping.
 * @property generationName - Provide a custom name for the generation (model output) event.
 * @property generationTags - Add custom tags to the generation for filtering or grouping.
 * @property spanId - Pass in a specific span ID to link this call to a particular span.
 * @property spanName - Override the default span name for this call.
 * @property spanTags - Add custom tags to the span for filtering or grouping.
 */
export type MaximVercelProviderMetadata = {
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
	/** Pass in a specific span id */
	spanId?: string;
	/** Override span name */
	spanName?: string;
	/** Add tags to generation */
	spanTags?: Record<string, string>;
};

/**
 * Extracts Maxim-specific provider metadata from the given language model call options.
 *
 * This function retrieves the `maxim` metadata object from the `providerMetadata` field of the options, for advanced tracing and logging in Maxim's observability system.
 *
 * @param options - The call options containing provider metadata.
 * @returns The extracted Maxim metadata with a guaranteed `spanId`, or undefined if not present.
 */
export function extractMaximMetadataFromOptions(options: LanguageModelV1CallOptions) {
	const metadata = options.providerMetadata;
	if (!metadata || !metadata["maxim"]) return undefined;
	const maximMetadata = metadata["maxim"] as MaximVercelProviderMetadata;
	return {
		...maximMetadata,
		spanId: maximMetadata.spanId ?? uuid(),
	} as MaximVercelProviderMetadata;
}

/**
 * Converts a LanguageModelV1Prompt into an array of CompletionRequest or ChatCompletionMessage objects.
 *
 * This function transforms the structured prompt format used by the Vercel AI SDK into the message format expected by downstream consumers, handling system, user, assistant, and tool roles.
 *
 * @param prompt - The prompt to be parsed, consisting of structured message parts.
 * @returns An array of parsed messages suitable for completion requests or chat completions.
 * @throws If an unsupported user message type is encountered.
 */
export function parsePromptMessages(prompt: LanguageModelV1Prompt): Array<CompletionRequest | ChatCompletionMessage> {
	const promptMessages: Array<CompletionRequest | ChatCompletionMessage> = prompt
		.map((promptMsg) => {
			switch (promptMsg.role) {
				case "system": {
					return [
						{
							role: "system",
							content: promptMsg.content,
						},
					] as Array<CompletionRequest | ChatCompletionMessage>;
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
											text: msg.text,
										};
									case "image":
										return {
											type: "image_url",
											image_url: {
												url: msg.image.toString(),
											},
										};
									default:
										throw new Error(`Unsupported user message type: ${msg.type}`);
								}
							}),
						},
					] as Array<CompletionRequest | ChatCompletionMessage>;
				}
				case "assistant": {
					const assistantText = promptMsg.content.find((msg) => msg.type === "text");
					const assistantToolCalls = promptMsg.content.filter((msg) => msg.type === "tool-call");
					return [
						{
							role: "assistant",
							content: assistantText?.text ?? null,
							tool_calls: assistantToolCalls.map((tool) => ({
								id: tool.toolCallId,
								type: "function",
								function: {
									name: tool.toolName,
									arguments: JSON.stringify(tool.args),
								},
							})),
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
		})
		.flat();

	return promptMessages;
}

/**
 * Represents the expected structure of a result from a language model generation call.
 *
 * This interface defines the minimal fields required for converting a generation result into a standardized chat completion result, including token usage and model information.
 *
 * @property usage - Token usage statistics for the generation.
 * @property usage.promptTokens - Number of tokens in the prompt.
 * @property usage.completionTokens - Number of tokens in the completion.
 * @property response - Optional response metadata, including model identifiers.
 * @property response.model_id - The model identifier (snake_case).
 * @property response.modelId - The model identifier (camelCase).
 * @property rawResponse - The raw response object from the model provider.
 */
interface DoGenerateResultLike {
	usage: {
		promptTokens: number;
		completionTokens: number;
	};
	response?: {
		model_id?: string;
		modelId?: string;
	};
	rawResponse?: any;
}

/**
 * Converts a doGenerate result object into a ChatCompletionResult format.
 *
 * This function adapts the result of a language model generation (including token usage, model info, and choices) into the standardized ChatCompletionResult structure expected by downstream consumers.
 *
 * @param result - The result object from a generation call, including usage, response, and rawResponse fields.
 * @returns The formatted chat completion result, including id, model, choices, and token usage.
 */
export function convertDoGenerateResultToChatCompletionResult(result: DoGenerateResultLike & { [key: string]: any }): ChatCompletionResult {
	return {
		id: uuid(),
		object: "chat_completion",
		created: Math.floor(Date.now() / 1000),
		model: result.response?.model_id ?? result.response?.modelId ?? "unknown",
		choices: Array.isArray(result.rawResponse?.body?.choices)
			? result.rawResponse?.body?.choices
			: Array.isArray(result.rawResponse?.body?.content)
				? result.rawResponse?.body?.content
				: [],
		usage: {
			prompt_tokens: result.usage.promptTokens,
			completion_tokens: result.usage.completionTokens,
			total_tokens: result.usage.promptTokens + result.usage.completionTokens,
		},
	};
}

/**
 * Processes a stream of language model output chunks and logs the result to Maxim tracing.
 *
 * This function aggregates streamed output parts, constructs a chat completion result, and finalizes the generation, span, and trace as appropriate. It also handles errors and ensures proper cleanup of tracing resources.
 *
 * @param chunks - The array of streamed output parts from the language model.
 * @param span - The Maxim tracing span associated with this generation.
 * @param trace - The Maxim tracing trace associated with this generation.
 * @param generation - The Maxim generation object to log the result to.
 * @param model - The model identifier used for this generation.
 * @param maximMetadata - Optional Maxim metadata for advanced tracing.
 */
export function processStream(
	chunks: LanguageModelV1StreamPart[],
	span: Span,
	trace: Trace,
	generation: Generation,
	model: string,
	maximMetadata: MaximVercelProviderMetadata | undefined,
) {
	try {
		const result = processChunks(chunks);

		generation.result({
			id: uuid(),
			object: "chat_completion",
			created: Math.floor(Date.now() / 1000),
			model: model,
			choices: [
				{
					index: 0,
					text: result.text,
					finish_reason: result.finishReason ?? "stop",
					logprobs: null,
				},
			],
			usage: {
				prompt_tokens: result.usage?.promptTokens ?? 0,
				completion_tokens: result.usage?.completionTokens ?? 0,
				total_tokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
			},
		});
		generation.end();
	} catch (error) {
		generation.error({
			message: (error as Error).message,
		});
		console.error("[Maxim SDK] Logging failed:", error);
	} finally {
		span.end();
		if (!maximMetadata?.traceId) trace.end();
	}
}

/**
 * Processes an array of streamed language model output chunks into a structured result.
 *
 * This function aggregates text, tool calls, token usage, and finish reason from the provided stream parts, returning a single object summarizing the output of the language model stream.
 *
 * @param chunks - The array of streamed output parts from the language model.
 * @returns An object containing the aggregated text, tool calls, token usage, and finish reason.
 */
function processChunks(chunks: LanguageModelV1StreamPart[]) {
	let text = "";
	const toolCalls: Record<string, LanguageModelV1FunctionToolCall> = {};
	let usage:
		| {
				promptTokens: number;
				completionTokens: number;
		  }
		| undefined = undefined;
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
