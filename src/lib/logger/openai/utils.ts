import type OpenAI from "openai";
import type { ChatCompletionMessage, CompletionRequest, CompletionRequestContent } from "../../models/prompt";
import type { ChatCompletionResult } from "../components/generation";

type ChatCompletionMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

/**
 * Utility functions for OpenAI integration with Maxim logging.
 */
export class OpenAIUtils {
	/**
	 * Parse OpenAI message params to Maxim's message format.
	 */
	static parseMessageParam(messages: ChatCompletionMessageParam[], overrideRole?: string): (CompletionRequest | ChatCompletionMessage)[] {
		const parsedMessages: (CompletionRequest | ChatCompletionMessage)[] = [];

		for (const msg of messages) {
			const role = overrideRole || msg.role;
			const content = "content" in msg ? msg.content : "";

			if (Array.isArray(content)) {
				// Handle content blocks for multimodal
				const parsedContent: CompletionRequestContent[] = [];
				let textContent = "";

				for (const block of content) {
					if (typeof block === "object" && block !== null && "type" in block) {
						if (block.type === "text" && "text" in block) {
							textContent += block.text;
							parsedContent.push({
								type: "text",
								text: block.text as string,
							});
						} else if (block.type === "image_url" && "image_url" in block) {
							const imageUrl = block.image_url as { url: string; detail?: string };
							parsedContent.push({
								type: "image_url",
								image_url: {
									url: imageUrl.url,
									detail: imageUrl.detail,
								},
							});
						}
					}
				}

				if (role === "assistant") {
					// Assistant messages use string content only
					parsedMessages.push({
						role: "assistant",
						content: textContent,
						tool_calls: "tool_calls" in msg ? convertToolCalls(msg.tool_calls) : undefined,
					} as ChatCompletionMessage);
				} else {
					// Non-assistant messages can have multimodal content
					parsedMessages.push({
						role: role as "user" | "system" | "tool" | "function",
						content: parsedContent.length > 0 ? parsedContent : textContent,
					} as CompletionRequest);
				}
			} else {
				const contentStr = content !== null && content !== undefined ? String(content) : "";

				if (role === "assistant") {
					parsedMessages.push({
						role: "assistant",
						content: contentStr,
						tool_calls: "tool_calls" in msg ? convertToolCalls(msg.tool_calls) : undefined,
					} as ChatCompletionMessage);
				} else {
					parsedMessages.push({
						role: role as "user" | "system" | "tool" | "function",
						content: contentStr,
					} as CompletionRequest);
				}
			}
		}

		return parsedMessages;
	}

	/**
	 * Extract model parameters from OpenAI request options.
	 */
	static getModelParams(options: Record<string, any>): Record<string, any> {
		const modelParams: Record<string, any> = {};
		const skipKeys = ["messages", "model", "extra_headers", "extra_body", "extra_query"];

		const paramKeys = [
			"temperature",
			"top_p",
			"presence_penalty",
			"frequency_penalty",
			"response_format",
			"tool_choice",
			"max_tokens",
			"max_completion_tokens",
			"n",
			"stop",
			"seed",
			"logprobs",
			"top_logprobs",
			"logit_bias",
			"user",
			"tools",
		];

		for (const key of paramKeys) {
			if (key in options && options[key] !== undefined && options[key] !== null) {
				modelParams[key] = options[key];
			}
		}

		// Include any additional parameters not in the known lists
		for (const [key, value] of Object.entries(options)) {
			if (!paramKeys.includes(key) && !skipKeys.includes(key) && value !== undefined && value !== null) {
				modelParams[key] = value;
			}
		}

		return modelParams;
	}

	/**
	 * Parse a non-streaming ChatCompletion response to Maxim's result format.
	 */
	static parseCompletion(completion: ChatCompletion): ChatCompletionResult {
		return {
			id: completion.id,
			object: completion.object,
			created: completion.created,
			model: completion.model,
			choices: completion.choices.map((choice) => ({
				index: choice.index,
				message: {
					role: choice.message.role as "assistant",
					content: choice.message.content,
					tool_calls: convertToolCalls(choice.message.tool_calls),
					function_call: choice.message.function_call
						? {
								name: choice.message.function_call.name,
								arguments: choice.message.function_call.arguments,
							}
						: undefined,
				},
				logprobs: choice.logprobs
					? {
							tokens: choice.logprobs.content?.map((c) => c.token),
							token_logprobs: choice.logprobs.content?.map((c) => c.logprob),
						}
					: null,
				finish_reason: choice.finish_reason || "stop",
			})),
			usage: completion.usage
				? {
						prompt_tokens: completion.usage.prompt_tokens,
						completion_tokens: completion.usage.completion_tokens,
						total_tokens: completion.usage.total_tokens,
					}
				: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
		};
	}

	/**
	 * Parse streaming chunks into a combined ChatCompletionResult.
	 */
	static parseCompletionFromChunks(chunks: ChatCompletionChunk[]): ChatCompletionResult {
		if (chunks.length === 0) {
			return {
				id: "",
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: "",
				choices: [],
				usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
			};
		}

		const lastChunk = chunks[chunks.length - 1];

		// Combine all content from chunks
		let combinedContent = "";
		for (const chunk of chunks) {
			for (const choice of chunk.choices) {
				if (choice.delta && choice.delta.content) {
					combinedContent += choice.delta.content;
				}
			}
		}

		// Combine all tool calls from chunks
		const toolCallsMap = new Map<
			number,
			{
				index: number;
				id: string;
				type: string;
				function: { name: string; arguments: string };
			}
		>();

		for (const chunk of chunks) {
			for (const choice of chunk.choices) {
				if (choice.delta && choice.delta.tool_calls) {
					for (const toolCall of choice.delta.tool_calls) {
						const existing = toolCallsMap.get(toolCall.index);
						if (!existing) {
							toolCallsMap.set(toolCall.index, {
								index: toolCall.index,
								id: toolCall.id || "",
								type: toolCall.type || "function",
								function: {
									name: toolCall.function?.name || "",
									arguments: toolCall.function?.arguments || "",
								},
							});
						} else {
							if (toolCall.id) {
								existing.id = toolCall.id;
							}
							if (toolCall.function?.name) {
								existing.function.name = toolCall.function.name;
							}
							if (toolCall.function?.arguments) {
								existing.function.arguments += toolCall.function.arguments;
							}
						}
					}
				}
			}
		}

		const toolCalls = Array.from(toolCallsMap.values());

		// Get finish reason from last chunk
		const finishReason = lastChunk.choices[0]?.finish_reason || "stop";

		// Get usage from the last chunk (if stream_options.include_usage was set)
		const usage = lastChunk.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

		return {
			id: lastChunk.id,
			object: "chat.completion",
			created: lastChunk.created,
			model: lastChunk.model,
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: toolCalls.length > 0 ? null : combinedContent,
						tool_calls:
							toolCalls.length > 0
								? toolCalls.map((tc) => ({
										id: tc.id,
										type: tc.type,
										function: tc.function,
									}))
								: undefined,
					},
					logprobs: null,
					finish_reason: finishReason,
				},
			],
			usage: {
				prompt_tokens: usage.prompt_tokens,
				completion_tokens: usage.completion_tokens,
				total_tokens: usage.total_tokens,
			},
		};
	}

	/**
	 * Extract combined text content from streaming chunks.
	 */
	static extractTextFromChunks(chunks: ChatCompletionChunk[]): string {
		let combinedText = "";
		for (const chunk of chunks) {
			for (const choice of chunk.choices) {
				if (choice.delta && choice.delta.content) {
					combinedText += choice.delta.content;
				}
			}
		}
		return combinedText;
	}

	// ========================================
	// Responses API Utilities
	// ========================================

	/**
	 * Parse Responses API input to generation messages format.
	 * Handles both simple string inputs and complex ResponseInputParam arrays.
	 */
	static parseResponsesInputToMessages(inputValue: any): (CompletionRequest | ChatCompletionMessage)[] {
		if (inputValue === null || inputValue === undefined) {
			return [];
		}

		// Simple string input
		if (typeof inputValue === "string") {
			return [{ role: "user", content: inputValue }];
		}

		// Not an array - wrap as user message
		if (!Array.isArray(inputValue)) {
			return [{ role: "user", content: String(inputValue) }];
		}

		const messages: (CompletionRequest | ChatCompletionMessage)[] = [];

		for (const item of inputValue) {
			// String item
			if (typeof item === "string") {
				messages.push({ role: "user", content: item });
				continue;
			}

			// Non-object item
			if (!item || typeof item !== "object") {
				messages.push({ role: "user", content: String(item) });
				continue;
			}

			const itemType = item.type;

			// EasyInputMessageParam or Message (both have role and content)
			if ("role" in item && "content" in item && (itemType === undefined || itemType === "message")) {
				let roleVal = item.role || "user";
				if (typeof roleVal !== "string" || roleVal.trim() === "") {
					roleVal = "user";
				}
				// Map developer -> system for internal roles
				const roleMap: Record<string, string> = { developer: "system" };
				const finalRole = roleMap[roleVal] || roleVal;
				const contentVal = item.content;

				if (typeof contentVal === "string") {
					if (finalRole === "assistant") {
						messages.push({ role: "assistant", content: contentVal });
					} else {
						messages.push({ role: finalRole as CompletionRequest["role"], content: contentVal });
					}
				} else {
					// Complex content - extract text parts
					const textContent = extractContentFromInputMessageList(contentVal);
					if (finalRole === "assistant") {
						messages.push({ role: "assistant", content: textContent });
					} else {
						messages.push({ role: finalRole as CompletionRequest["role"], content: textContent });
					}
				}
				continue;
			}

			// ResponseOutputMessageParam (assistant)
			if (itemType === "message" && item.role === "assistant" && "content" in item) {
				const assistantText = extractAssistantTextFromOutputMessage(item.content);
				messages.push({ role: "assistant", content: assistantText });
				continue;
			}

			// Function/tool CALL intents (assistant role)
			if (
				itemType === "function_call" ||
				itemType === "file_search_call" ||
				itemType === "computer_call" ||
				itemType === "code_interpreter_call" ||
				itemType === "web_search_call" ||
				itemType === "local_shell_call" ||
				itemType === "image_generation_call"
			) {
				const name = item.name || itemType;
				const args = item.arguments || item.queries || item.action;
				const callId = item.call_id || item.id;
				let summary = `${name} call`;
				if (callId) summary += ` id=${callId}`;
				if (args !== undefined) summary += ` args=${JSON.stringify(args)}`;
				messages.push({ role: "assistant", content: summary });
				continue;
			}

			// Tool OUTPUTS (tool role)
			if (itemType === "function_call_output" || itemType === "local_shell_call_output" || itemType === "computer_call_output") {
				if (itemType === "computer_call_output") {
					const output = item.output;
					if (output && typeof output === "object" && output.type === "computer_screenshot") {
						const imageUrl = output.image_url;
						if (typeof imageUrl === "string" && imageUrl) {
							messages.push({
								role: "tool",
								content: [{ type: "image_url", image_url: { url: imageUrl } }],
							} as CompletionRequest);
							continue;
						}
					}
				}
				// Default: pass raw output as string
				const outVal = item.output;
				messages.push({
					role: "tool",
					content: outVal !== undefined ? String(outVal) : "",
				} as CompletionRequest);
				continue;
			}

			// MCP items
			if (
				itemType === "mcp_list_tools" ||
				itemType === "mcp_approval_request" ||
				itemType === "mcp_approval_response" ||
				itemType === "mcp_call"
			) {
				if (itemType === "mcp_call" && item.output !== undefined) {
					messages.push({ role: "tool", content: String(item.output) } as CompletionRequest);
				} else if (itemType === "mcp_approval_response") {
					messages.push({ role: "tool", content: summarizeObject(item) } as CompletionRequest);
				} else {
					messages.push({ role: "assistant", content: summarizeObject(item) });
				}
				continue;
			}

			// Reasoning item -> assistant
			if (itemType === "reasoning") {
				const summary = item.summary;
				let txt: string;
				if (Array.isArray(summary)) {
					txt = summary
						.filter((s: any) => s && typeof s === "object")
						.map((s: any) => s.text || "")
						.join("");
				} else {
					txt = String(summary);
				}
				messages.push({ role: "assistant", content: txt });
				continue;
			}

			// Item reference -> assistant note
			if (itemType === "item_reference" || ("id" in item && item.type === undefined && Object.keys(item).length === 1)) {
				messages.push({ role: "assistant", content: `[item_reference] id=${item.id}` });
				continue;
			}

			// Unknown dict item -> user as final fallback
			messages.push({ role: "user", content: String(item) });
		}

		return messages;
	}

	/**
	 * Extract model parameters from Responses API request options.
	 * Skips input, extra_headers, and model.
	 */
	static getResponsesModelParams(options: Record<string, any>): Record<string, any> {
		const modelParams: Record<string, any> = {};
		const skipKeys = ["input", "extra_headers", "model"];

		for (const [key, value] of Object.entries(options)) {
			if (!skipKeys.includes(key) && value !== undefined && value !== null) {
				modelParams[key] = value;
			}
		}

		return modelParams;
	}

	/**
	 * Extract text output from a Responses API response.
	 * Returns the output_text property if available, or null.
	 */
	static extractResponsesOutputText(response: any): string | null {
		try {
			// Try output_text property (getter in OpenAI SDK Response objects)
			const outputText = response?.output_text;
			if (typeof outputText === "string" && outputText.length > 0) {
				return outputText;
			}
		} catch {
			// Ignore
		}

		// Fallback for dict-like structure - handle nested message content
		try {
			if (response && typeof response === "object") {
				const output = response.output;
				if (Array.isArray(output)) {
					const texts: string[] = [];
					for (const item of output) {
						if (item && typeof item === "object") {
							// Handle direct output_text or text items
							if (item.type === "output_text" || item.type === "text") {
								const textVal = item.text || item.content;
								if (typeof textVal === "string") {
									texts.push(textVal);
								}
							}
							// Handle message items with nested content array (actual Responses API structure)
							else if (item.type === "message" && Array.isArray(item.content)) {
								for (const contentItem of item.content) {
									if (contentItem && typeof contentItem === "object") {
										if (contentItem.type === "output_text" || contentItem.type === "text") {
											const textVal = contentItem.text || contentItem.content;
											if (typeof textVal === "string") {
												texts.push(textVal);
											}
										}
									}
								}
							}
						}
					}
					if (texts.length > 0) {
						return texts.join("");
					}
				}
			}
		} catch {
			// Ignore
		}

		return null;
	}
}

/**
 * Helper to extract text content from ResponseInputMessageContentListParam.
 */
function extractContentFromInputMessageList(items: any): string {
	if (!Array.isArray(items)) {
		return String(items);
	}

	const contentList: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== "object") {
			contentList.push(String(item));
			continue;
		}

		const t = item.type;
		if (t === "input_text" && "text" in item) {
			contentList.push(String(item.text || ""));
		} else if (t === "input_image") {
			const imageUrl = item.image_url;
			const fileId = item.file_id;
			const urlVal = imageUrl || (fileId ? `file:${fileId}` : null);
			if (urlVal) {
				contentList.push(`[image:${urlVal}]`);
			} else {
				contentList.push("[image]");
			}
		} else if (t === "input_file") {
			const name = item.filename || item.file_url || item.file_id;
			contentList.push(`[file:${name}]`);
		} else {
			contentList.push(String(item));
		}
	}

	return contentList.join(" ");
}

/**
 * Helper to extract text from assistant output message content.
 */
function extractAssistantTextFromOutputMessage(content: any): string {
	if (!Array.isArray(content)) {
		return String(content);
	}

	const parts: string[] = [];
	for (const c of content) {
		if (c && typeof c === "object") {
			const t = c.type;
			if (t === "output_text") {
				const txt = c.text;
				if (typeof txt === "string") {
					parts.push(txt);
				}
			} else if (t === "refusal") {
				const ref = c.refusal;
				if (typeof ref === "string") {
					parts.push(`[refusal] ${ref}`);
				}
			} else {
				parts.push(String(c));
			}
		} else {
			parts.push(String(c));
		}
	}
	return parts.join("");
}

/**
 * Helper to summarize an object for logging.
 */
function summarizeObject(obj: Record<string, any>): string {
	try {
		const typ = obj["type"];
		if (typ) {
			const entries = Object.entries(obj)
				.filter(([k]) => k !== "type")
				.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
				.join(", ");
			return `[${typ}] ${entries}`;
		}
	} catch {
		// Ignore
	}
	return String(obj);
}

/**
 * Convert OpenAI tool calls to Maxim's format.
 */
function convertToolCalls(
	toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
): ChatCompletionMessage["tool_calls"] | undefined {
	if (!toolCalls) return undefined;

	return toolCalls.map((tc) => {
		// Handle both standard function tool calls and custom tool calls
		if ("function" in tc && tc.function) {
			return {
				id: tc.id,
				type: tc.type,
				function: {
					name: tc.function.name,
					arguments: tc.function.arguments,
				},
			};
		}
		// Fallback for custom tool calls that may not have function property
		return {
			id: tc.id,
			type: tc.type,
			function: {
				name: "",
				arguments: "",
			},
		};
	});
}
