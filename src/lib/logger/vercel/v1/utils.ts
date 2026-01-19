import { LanguageModelV1FunctionToolCall, LanguageModelV1Prompt, LanguageModelV1StreamPart } from "ai-sdk-provider-v1";
import { ChatCompletionMessage, ChatCompletionResult, CompletionRequest, CompletionRequestContent, Generation, Span, Trace } from "index";
import { DoGenerateResultLike } from "../types";
import { v4 as uuid } from "uuid";
import { MaximVercelProviderMetadata } from "../types";

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
		// Note: Trace ending is now handled by the wrapper to support tool-call sequences
		// Only end trace here if user explicitly provided traceId (they manage it)
		// Otherwise, the wrapper will handle trace ending based on tool-call detection
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
