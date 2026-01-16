import {
	LanguageModelV3GenerateResult,
	LanguageModelV3Prompt,
	LanguageModelV3StreamPart,
	LanguageModelV3ToolCall,
} from "ai-sdk-provider-v3";
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
import { parseToolResultOutput } from "../utils";
import { v4 as uuid } from "uuid";
import { MaximVercelProviderMetadata } from "../types";
import type { Attachment, FileDataAttachment, UrlAttachment } from "../../../types";

/**
 * Converts a LanguageModelV3Prompt into an array of CompletionRequest or ChatCompletionMessage objects.
 *
 * This function transforms the structured prompt format used by the Vercel AI SDK v3 into the message format expected by downstream consumers, handling system, user, assistant, and tool roles.
 * It also extracts file attachments from file messages.
 *
 * @param prompt - The prompt to be parsed, consisting of structured message parts.
 * @returns An object containing parsed messages and extracted file attachments.
 * @throws If an unsupported user message type is encountered.
 */
export function parsePromptMessagesV3(
	prompt: LanguageModelV3Prompt,
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
								// Handle different data types: Uint8Array, string (base64), or URL
								let attachment: Attachment;
								
								// Check if data is a URL object
								if (msg.data instanceof URL || (typeof msg.data === "object" && msg.data !== null && "href" in msg.data)) {
									// If it's a URL, create a URL attachment
									const urlString = msg.data instanceof URL ? msg.data.toString() : (msg.data as any).href;
									attachment = {
										id: uuid(),
										type: "url",
										url: urlString,
										mimeType: msg.mediaType,
										tags: { attachedTo: "input" },
									} as UrlAttachment;
								} else if (typeof msg.data === "string") {
									// Convert base64 string to Buffer
									let fileData: Buffer;
									// If it's a base64 string, decode it
									if (msg.data.startsWith("data:")) {
										const match = msg.data.match(/^data:([^;]+);base64,(.+)$/);
										if (match) {
											const base64Data = match[2];
											fileData = Buffer.from(base64Data, "base64");
										} else {
											// Assume it's already base64 without the data URI prefix
											fileData = Buffer.from(msg.data, "base64");
										}
									} else {
										// Assume it's base64 encoded
										fileData = Buffer.from(msg.data, "base64");
									}

									// Extract file extension from mediaType if possible
									const mediaTypeParts = msg.mediaType?.split("/") || [];
									const extension = mediaTypeParts[1]?.split(";")[0] || "bin";
									
									// Create fileData attachment
									attachment = {
										id: uuid(),
										type: "fileData",
										data: fileData,
										mimeType: msg.mediaType,
										name: `file.${extension}`,
										tags: { attachedTo: "input" },
									} as FileDataAttachment;
								} else {
									// It's a Uint8Array, convert to Buffer
									const fileData = Buffer.from(msg.data);
									
									// Extract file extension from mediaType if possible
									const mediaTypeParts = msg.mediaType?.split("/") || [];
									const extension = mediaTypeParts[1]?.split(";")[0] || "bin";
									
									// Create fileData attachment
									attachment = {
										id: uuid(),
										type: "fileData",
										data: fileData,
										mimeType: msg.mediaType,
										name: `file.${extension}`,
										tags: { attachedTo: "input" },
									} as FileDataAttachment;
								}
								
								attachments.push(attachment);

								// Don't include file content in the message - it's now an attachment
								// The parseAttachmentsFromMessages function will handle image_url types,
								// but we've already extracted the file data, so we skip adding it to content
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
 * Converts a doGenerate result object into a ChatCompletionResult format.
 *
 * This function adapts the result of a language model generation v3 (including token usage, model info, and choices) into the standardized ChatCompletionResult structure expected by downstream consumers.
 *
 * @param result - The result object from a generation call, including usage, response, and content fields.
 * @returns The formatted chat completion result, including id, model, choices, and token usage.
 */
export function convertDoGenerateResultToChatCompletionResultV3(result: LanguageModelV3GenerateResult): ChatCompletionResult {
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
							content: content.data,
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
export function processStreamV3(
	chunks: LanguageModelV3StreamPart[],
	span: Span,
	trace: Trace,
	generation: Generation,
	model: string,
	maximMetadata: MaximVercelProviderMetadata | undefined,
) {
	try {
		const result = processChunksV3(chunks);

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
function processChunksV3(chunks: LanguageModelV3StreamPart[]) {
	let text = "";
	const toolCalls: Record<string, LanguageModelV3ToolCall> = {};
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
