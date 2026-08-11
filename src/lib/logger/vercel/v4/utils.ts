import {
	LanguageModelV4GenerateResult,
	LanguageModelV4Prompt,
	LanguageModelV4StreamPart,
	LanguageModelV4ToolCall,
} from "ai-sdk-provider-v4";
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
import { v4 as uuid } from "uuid";
import { MaximVercelProviderMetadata } from "../types";
import type { Attachment, FileDataAttachment, UrlAttachment } from "../../../types";

/**
 * Decodes a base64 (or `data:` URI) string into a Buffer.
 *
 * AI SDK v4 file parts carry inline bytes as either a raw Uint8Array or a
 * base64-encoded string (optionally wrapped in a `data:...;base64,` URI). This
 * normalizes the string form into a Buffer for attachment handling.
 *
 * @param data - The base64 string, optionally with a data URI prefix.
 * @returns The decoded file bytes.
 */
function decodeBase64FileData(data: string): Buffer {
	if (data.startsWith("data:")) {
		const match = data.match(/^data:([^;]+);base64,(.+)$/);
		if (match) {
			return Buffer.from(match[2], "base64");
		}
	}
	// Assume it's already base64 without the data URI prefix
	return Buffer.from(data, "base64");
}

/**
 * Derives a file extension from an IANA media type, defaulting to `bin`.
 *
 * @param mediaType - The IANA media type (e.g. `image/png`) or undefined.
 * @returns The subtype used as a file extension, or `bin` if not derivable.
 */
function extensionFromMediaType(mediaType: string | undefined): string {
	const mediaTypeParts = mediaType?.split("/") || [];
	return mediaTypeParts[1]?.split(";")[0] || "bin";
}

/**
 * Renders a generated v4 file part's data as a loggable string.
 *
 * v4 file data is a tagged union: a URL, or inline bytes (`Uint8Array`) /
 * base64 string. `String(uint8array)` would yield unusable comma-separated
 * digits ("137,80,78,..."), so raw bytes are base64-encoded instead.
 *
 * @param data - The file part's `data` (URL or inline-data variant).
 * @returns A URL string, the base64 string as-is, or base64 of the raw bytes.
 */
function renderFileContent(data: { type: "url"; url: URL } | { type: "data"; data: Uint8Array | string }): string {
	if (data.type === "url") {
		return data.url.toString();
	}
	return typeof data.data === "string" ? data.data : Buffer.from(data.data).toString("base64");
}

/**
 * Converts a LanguageModelV4Prompt into an array of CompletionRequest or ChatCompletionMessage objects.
 *
 * This function transforms the structured prompt format used by the Vercel AI SDK v4 (AI SDK 7) into the message format expected by downstream consumers, handling system, user, assistant, and tool roles.
 * It also extracts file attachments from file messages.
 *
 * Note: unlike v3, v4 file parts carry their payload as a tagged discriminated
 * union (`{ type: 'data' | 'url' | 'text' | 'reference' }`) rather than a bare
 * `Uint8Array | string | URL`, so file handling switches on `data.type`.
 *
 * @param prompt - The prompt to be parsed, consisting of structured message parts.
 * @returns An object containing parsed messages and extracted file attachments.
 * @throws If an unsupported user message type is encountered.
 */
export function parsePromptMessagesV4(
	prompt: LanguageModelV4Prompt,
): {
	messages: Array<CompletionRequest | ChatCompletionMessage>;
	attachments: Attachment[];
} {
	const attachments: Attachment[] = [];
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
					const contentItems: CompletionRequestContent[] = [];

					for (const msg of promptMsg.content) {
						switch (msg.type) {
							case "text":
								contentItems.push({
									type: "text",
									text: msg.text,
								});
								break;
							case "file": {
								// v4 file data is a tagged discriminated union
								const fileData = msg.data;
								switch (fileData.type) {
									case "url": {
										attachments.push({
											id: uuid(),
											type: "url",
											url: fileData.url.toString(),
											mimeType: msg.mediaType,
											tags: { attachedTo: "input" },
										} as UrlAttachment);
										break;
									}
									case "data": {
										// Raw bytes (Uint8Array) or a base64-encoded string
										const buffer =
											typeof fileData.data === "string"
												? decodeBase64FileData(fileData.data)
												: Buffer.from(fileData.data);
										const extension = extensionFromMediaType(msg.mediaType);
										attachments.push({
											id: uuid(),
											type: "fileData",
											data: buffer,
											mimeType: msg.mediaType,
											name: `file.${extension}`,
											tags: { attachedTo: "input" },
										} as FileDataAttachment);
										break;
									}
									case "text": {
										// Inline text document — surface it as message text rather than an attachment
										contentItems.push({
											type: "text",
											text: fileData.text,
										});
										break;
									}
									case "reference": {
										// Provider-side reference with no downloadable payload — nothing to attach
										break;
									}
									default:
										break;
								}
								break;
							}
							default:
								throw new Error(`Unsupported user message type: ${msg}`);
						}
					}

					// Only create user message if there's content (text or other non-file items)
					if (contentItems.length > 0) {
						return [
							{
								role: "user",
								content: contentItems,
							},
						] as Array<CompletionRequest | ChatCompletionMessage>;
					} else {
						// If all content was files, return empty string content
						return [
							{
								role: "user",
								content: "",
							},
						] as Array<CompletionRequest | ChatCompletionMessage>;
					}
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
					const toolCalls = promptMsg.content.filter((part) => part.type === "tool-result");
					return [
						...toolCalls.map((tool) => ({
							role: "tool" as const,
							tool_call_id: tool.toolCallId,
							content: parseToolResultOutput(tool.output),
						})),
					];
				}
			}
		})
		.flat();

	return { messages: promptMessages, attachments };
}

/**
 * Processes tool results from the raw prompt and logs them to Maxim.
 * Calls toolCallError for error-type results (error-text, error-json) and toolCallResult for successes.
 *
 * @param prompt - The raw LanguageModelV4 prompt containing tool results
 * @param logger - The MaximLogger instance for logging tool results/errors
 */
export function processToolResultsFromPromptV4(prompt: LanguageModelV4Prompt, logger: MaximLogger): void {
	for (const promptMsg of prompt) {
		if (promptMsg.role !== "tool") continue;

		for (const part of promptMsg.content) {
			if (part.type !== "tool-result") continue;

			const toolCallId = (part as { toolCallId: string }).toolCallId;
			const output = (part as { output: { type: string; value?: unknown } }).output;
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
 * This function adapts the result of a language model generation v4 (including token usage, model info, and choices) into the standardized ChatCompletionResult structure expected by downstream consumers.
 *
 * @param result - The result object from a generation call, including usage, response, and content fields.
 * @returns The formatted chat completion result, including id, model, choices, and token usage.
 */
export function convertDoGenerateResultToChatCompletionResultV4(result: LanguageModelV4GenerateResult): ChatCompletionResult {
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
						finish_reason: result.finishReason.unified,
						logprobs: null,
					} as ChatCompletionChoice;
				case "file":
					return {
						index,
						message: {
							// v4 file data is a tagged union ({ type: 'data' | 'url' })
							content: renderFileContent(content.data),
							role: "assistant",
						},
						finish_reason: result.finishReason.unified,
						logprobs: null,
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
						finish_reason: result.finishReason.unified,
					} as ChatCompletionChoice;
				case "tool-result":
					return {
						index,
						logprobs: null,
						message: {
							content: typeof content.result === "string" ? content.result : JSON.stringify(content.result),
							role: "assistant",
						},
						finish_reason: result.finishReason.unified,
					} as ChatCompletionChoice;
				case "source":
					return {
						index,
						logprobs: null,
						message: {
							content: content.sourceType === "url" ? content.url : content.title,
							role: "assistant",
						},
						finish_reason: result.finishReason.unified,
					} as ChatCompletionChoice;
				default:
					return {
						index,
						logprobs: null,
						message: {
							content: JSON.stringify(content),
							role: "assistant",
						},
						finish_reason: result.finishReason.unified,
					} as ChatCompletionChoice;
			}
		}),
		usage: {
			prompt_tokens: result.usage.inputTokens.total ?? 0,
			completion_tokens: result.usage.outputTokens.total ?? 0,
			total_tokens: (result.usage.inputTokens.total ?? 0) + (result.usage.outputTokens.total ?? 0),
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
export function processStreamV4(
	chunks: LanguageModelV4StreamPart[],
	span: Span,
	trace: Trace,
	generation: Generation,
	model: string,
	maximMetadata: MaximVercelProviderMetadata | undefined,
) {
	try {
		const result = processChunksV4(chunks);

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
							// Chat-completion tool calls use "function"; the stream part's own
							// discriminator is "tool-call". Normalize so streamed and
							// non-streamed results log the same shape.
							type: "function",
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
function processChunksV4(chunks: LanguageModelV4StreamPart[]) {
	let text = "";
	const toolCalls: Record<string, LanguageModelV4ToolCall> = {};
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
					promptTokens: chunk.usage.inputTokens.total ?? 0,
					completionTokens: chunk.usage.outputTokens.total ?? 0,
				};
				finishReason = chunk.finishReason.unified;
				break;
		}
	}

	return { text, toolCalls: Object.values(toolCalls), usage, finishReason };
}
