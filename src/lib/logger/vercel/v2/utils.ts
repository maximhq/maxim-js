import { LanguageModelV2Prompt, LanguageModelV2StreamPart, LanguageModelV2ToolCall } from "ai-sdk-provider-v2";
import {
	ChatCompletionChoice,
	ChatCompletionMessage,
	ChatCompletionResult,
	CompletionRequest,
	CompletionRequestContent,
	Generation,
	Span,
	Trace,
} from "index";
import type { MaximLogger } from "../../logger";
import type { ToolCallError } from "../../components/toolCall";
import { extractErrorInfo, parseToolResultOutput } from "../utils";

import { DoGenerateV2Result, MaximVercelProviderMetadata } from "../types";
import { v4 as uuid } from "uuid";

/**
 * Converts a LanguageModelV2Prompt into an array of CompletionRequest or ChatCompletionMessage objects.
 *
 * This function transforms the structured prompt format used by the Vercel AI SDK v2 into the message format expected by downstream consumers, handling system, user, assistant, and tool roles.
 *
 * @param prompt - The prompt to be parsed, consisting of structured message parts.
 * @returns An array of parsed messages suitable for completion requests or chat completions.
 * @throws If an unsupported user message type is encountered.
 */
export function parsePromptMessagesV2(prompt: LanguageModelV2Prompt): Array<CompletionRequest | ChatCompletionMessage> {
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
									case "file":
										return {
											type: "image_url",
											image_url: {
												url: msg.filename ?? "",
											},
										};
									default: {
										// Try to extract type or serialize the message for better error reporting
										const msgType = (msg as any)?.type ?? "unknown";
										let msgString: string;
										try {
											msgString = JSON.stringify(msg);
										} catch {
											msgString = `[object with type: ${msgType}]`;
										}
										throw new Error(`Unsupported user message type: ${msgType} (${msgString})`);
									}
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
									arguments: JSON.stringify(tool.input),
								},
							})),
						},
					] as Array<CompletionRequest | ChatCompletionMessage>;
				}
				case "tool": {
					return promptMsg.content.map((part) => ({
						role: "tool",
						tool_call_id: part.toolCallId,
						content: parseToolResultOutput(part.output),
					})) as Array<CompletionRequest | ChatCompletionMessage>;
				}
			}
		})
		.flat();

	return promptMessages;
}

/**
 * Processes tool results from the raw prompt and logs them to Maxim.
 * Calls toolCallError for error-type results (error-text, error-json) and toolCallResult for successes.
 *
 * @param prompt - The raw LanguageModelV2 prompt containing tool results
 * @param logger - The MaximLogger instance for logging tool results/errors
 */
export function processToolResultsFromPromptV2(prompt: LanguageModelV2Prompt, logger: MaximLogger): void {
	for (const promptMsg of prompt) {
		if (promptMsg.role !== "tool") continue;

		for (const part of promptMsg.content) {
			if (part.type !== "tool-result") continue;

			const toolCallId = (part as { toolCallId: string }).toolCallId;
			const output = (part as { output: { type: string; value: unknown } }).output;
			const isError = output.type === "error-text" || output.type === "error-json";

			if (isError) {
				const errorInfo = extractErrorInfo(output.value) as ToolCallError;
				logger.toolCallError(toolCallId, errorInfo);
			} else {
				const content = parseToolResultOutput(output as Parameters<typeof parseToolResultOutput>[0]);
				logger.toolCallResult(toolCallId, content);
			}
		}
	}
}

/**
 * Converts a doGenerate result object into a ChatCompletionResult format.
 *
 * This function adapts the result of a language model generation v2 (including token usage, model info, and choices) into the standardized ChatCompletionResult structure expected by downstream consumers.
 *
 * @param result - The result object from a generation call, including usage, response, and content fields.
 * @returns The formatted chat completion result, including id, model, choices, and token usage.
 */
export function convertDoGenerateResultToChatCompletionResultV2(result: DoGenerateV2Result): ChatCompletionResult {
	return {
		id: uuid(),
		object: "chat_completion",
		created: Math.floor(Date.now() / 1000),
		model: result.response?.modelId ?? "unknown",
		choices: result.content.map((content, index) => {
			switch (content.type) {
				case "text":
					return {
						index,
						message: {
							content: content.text,
							role: "assistant",
						},
						finish_reason: result.finishReason,
					} as ChatCompletionChoice;
				case "file":
					return {
						index,
						message: {
							content: content.data,
							role: "assistant",
						},
						finish_reason: result.finishReason,
					} as ChatCompletionChoice;
				case "tool-call":
					return {
						index,
						logprobs: null,
						message: {
							content: null,
							role: "assistant",
							tool_calls: [
								{
									id: content.toolCallId,
									type: "function",
									function: {
										name: content.toolName,
										arguments: content.input,
									},
								},
							],
						},
						finish_reason: result.finishReason,
					} as ChatCompletionChoice;
				case "tool-result":
					return {
						index,
						logprobs: null,
						message: {
							content: typeof content.result === "string" ? content.result : JSON.stringify(content.result),
							role: "assistant",
						},
						finish_reason: result.finishReason,
					} as ChatCompletionChoice;
				case "source":
					return {
						index,
						logprobs: null,
						message: {
							content: content.sourceType === "url" ? content.url : content.title,
							role: "assistant",
						},
						finish_reason: result.finishReason,
					} as ChatCompletionChoice;
				default:
					return {
						index,
						logprobs: null,
						message: {
							content: JSON.stringify(content),
							role: "assistant",
						},
						finish_reason: result.finishReason,
					} as ChatCompletionChoice;
			}
		}),
		usage: {
			prompt_tokens: result.usage.inputTokens ?? 0,
			completion_tokens: result.usage.outputTokens ?? 0,
			total_tokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
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
export function processStreamV2(
	chunks: LanguageModelV2StreamPart[],
	span: Span,
	trace: Trace,
	generation: Generation,
	model: string,
	maximMetadata: MaximVercelProviderMetadata | undefined,
) {
	try {
		const result = processChunksV2(chunks);

		generation.result({
			id: uuid(),
			object: "chat_completion",
			created: Math.floor(Date.now() / 1000),
			model: model,
			choices: [
				{
					index: 0,
					message: {
						tool_calls: result.toolCalls.map((toolCall) => ({
							id: toolCall.toolCallId,
							type: toolCall.type,
							function: {
								name: toolCall.toolName,
								arguments: toolCall.input,
							},
						})),
						content: result.text,
						role: "assistant",
					},
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
function processChunksV2(chunks: LanguageModelV2StreamPart[]) {
	let text = "";
	const toolCalls: Record<string, LanguageModelV2ToolCall> = {};
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
				text += chunk.delta;
				break;
			case "tool-call":
				toolCalls[chunk.toolCallId] = chunk;
				break;
			case "tool-result":
				text += typeof chunk.result === "string" ? chunk.result : JSON.stringify(chunk.result);
				break;
			case "finish":
				usage = {
					promptTokens: chunk.usage.inputTokens ?? 0,
					completionTokens: chunk.usage.outputTokens ?? 0,
				};
				finishReason = chunk.finishReason;
				break;
		}
	}

	return { text, toolCalls: Object.values(toolCalls), usage, finishReason };
}
