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
