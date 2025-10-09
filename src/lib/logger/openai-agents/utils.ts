import { v4 as uuid } from "uuid";
import type { ChatCompletionMessage, CompletionRequest } from "../../models/prompt";
import type { ChatCompletionResult } from "../components";

/**
 * Convert an OpenAI Responses API object (or its `output` array) into a ChatCompletionResult.
 *
 * Accepts either the full Responses API response shape:
 * {
 *   id, object: "response", created_at, model, output: Item[], usage?: { input_tokens?, output_tokens?, total_tokens? }
 * }
 * or a bare `output: Item[]` array.
 */
export function convertOpenAIResponsesToCompletionResult(input: any): {
	completionResult: ChatCompletionResult;
	modelParameters: Record<string, any>;
} {
	const isFullResponse = input && typeof input === "object" && (Array.isArray(input.output) || Array.isArray(input.output_text));
	const outputItems: any[] = Array.isArray(input) ? input : isFullResponse && Array.isArray(input.output) ? input.output : [];

	// Extract assistant text content (concatenate text parts) and tool calls if present
	let accumulatedText: string[] = [];
	let toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

	for (const item of outputItems) {
		// Responses API typically emits a `message` item containing `content`
		if (item && item.type === "message" && Array.isArray(item.content)) {
			for (const part of item.content) {
				// Common text part shape: { type: 'output_text', text: string }
				if (part && typeof part === "object") {
					if (typeof part.text === "string") {
						accumulatedText.push(part.text);
						continue;
					}
					// Some SDKs may surface plain text as { type: 'text', text }
					if (part.type === "text" && typeof part.text === "string") {
						accumulatedText.push(part.text);
						continue;
					}
					// Structured outputs may appear as an object; serialize for logging compatibility
					if (part.type && part.type.toString().toLowerCase().includes("json")) {
						const str = safeStringify(part.object ?? part.value ?? part);
						if (str) accumulatedText.push(str);
						continue;
					}
					// Tool/function call variants (best-effort support)
					if (
						(part.type === "tool_call" || part.type === "tool-use" || part.type === "tool_use" || part.type === "function_call") &&
						(part.name || part.function?.name)
					) {
						const id = part.id || part.tool_call_id || part.call_id || part.callId || uuid();
						const name: string = part.name ?? part.function?.name ?? "unknown_tool";
						const rawArgs = part.arguments ?? part.input ?? part.function?.arguments ?? {};
						const args = typeof rawArgs === "string" ? rawArgs : safeStringify(rawArgs) ?? "{}";
						toolCalls.push({ id, type: "function", function: { name, arguments: args } });
						continue;
					}
					// Fallback: stringify anything else we don't recognize
					const fallback = safeStringify(part);
					if (fallback) accumulatedText.push(fallback);
				}
			}
		}

		// Top-level function/tool calls may also be emitted directly in `output`.
		// Normalize them into Chat Completions tool_calls for compatibility.
		if (item && typeof item === "object") {
			// function_call item from Responses API
			if (item.type === "function_call" && (item.name || item.function?.name)) {
				const id = item.callId || item.call_id || item.id || uuid();
				const name: string = item.name ?? item.function?.name ?? "unknown_tool";
				const rawArgs = item.arguments ?? item.input ?? item.function?.arguments ?? {};
				const args = typeof rawArgs === "string" ? rawArgs : safeStringify(rawArgs) ?? "{}";
				toolCalls.push({ id, type: "function", function: { name, arguments: args } });
				continue;
			}
			// Hosted/other tool call variants: map best-effort to function style for logging
			if (
				(item.type === "tool_call" || item.type === "hosted_tool_call" || item.type === "tool-use" || item.type === "tool_use") &&
				(item.name || item.function?.name)
			) {
				const id = item.id || item.tool_call_id || item.call_id || item.callId || uuid();
				const name: string = item.name ?? item.function?.name ?? "unknown_tool";
				const rawArgs = item.arguments ?? item.input ?? item.function?.arguments ?? item.providerData?.arguments ?? {};
				const args = typeof rawArgs === "string" ? rawArgs : safeStringify(rawArgs) ?? "{}";
				toolCalls.push({ id, type: "function", function: { name, arguments: args } });
				continue;
			}
		}
	}

	const message: ChatCompletionMessage = {
		role: "assistant",
		content: accumulatedText.length ? accumulatedText.join("\n\n") : toolCalls.length ? null : "",
		...(toolCalls.length ? { tool_calls: toolCalls } : {}),
	};

	const createdSeconds = isFullResponse && typeof input.created_at === "number" ? input.created_at : Math.floor(Date.now() / 1000);
	const model = (isFullResponse && (input.model as string)) || "unknown";

	const promptTokens = (isFullResponse && (input.usage?.input_tokens ?? input.usage?.prompt_tokens)) ?? 0;
	const completionTokens = (isFullResponse && (input.usage?.output_tokens ?? input.usage?.completion_tokens)) ?? 0;
	const totalTokens = (isFullResponse && (input.usage?.total_tokens ?? promptTokens + completionTokens)) ?? promptTokens + completionTokens;

	const completionResult: ChatCompletionResult = {
		id: (isFullResponse && (input.id as string)) || uuid(),
		object: "chat_completion",
		created: createdSeconds,
		model,
		choices: [
			{
				index: 0,
				message,
				logprobs: null,
				finish_reason: inferFinishReason(input) ?? "stop",
			},
		],
		usage: {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: totalTokens,
		},
	};

	const modelParameters = extractModelParametersFromResponses(input);

	return { completionResult, modelParameters };
}

/**
 * Convert an OpenAI Responses API-style messages array into a sequence of
 * CompletionRequest / ChatCompletionMessage items compatible with Chat Completions.
 *
 * Input examples include items like:
 * - { type: "message", role: "user" | "system" | "assistant", content: string | Part[] }
 * - { type: "function_call" | "tool_call" | "tool-use", name, arguments, callId?, id? }
 * - { type: "function_call_result" | "tool_result" | "tool-call-result", callId?, output }
 *
 * Mapping rules:
 * - Consecutive function/tool call items are batched into one assistant message with tool_calls.
 * - Each result item becomes a tool message with tool_call_id referring to its originating call.
 * - Assistant message content is null when tool_calls are present, otherwise text if available.
 */
export function convertOpenAIResponsesMessagesToCompletionMessages(items: any[]): Array<CompletionRequest | ChatCompletionMessage> {
	const results: Array<CompletionRequest | ChatCompletionMessage> = [];

	// Track pending tool calls to batch consecutive calls
	let pendingToolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

	// Map to resolve tool_call_id for results
	const callKeyToId = new Map<string, string>();

	const flushPending = () => {
		if (pendingToolCalls.length === 0) return;
		results.push({ role: "assistant", content: null, tool_calls: pendingToolCalls });
		pendingToolCalls = [];
	};

	for (const item of items ?? []) {
		if (!item || typeof item !== "object") continue;

		const type: string = String(item.type || "");

		// 1) Raw chat message
		if (type === "message") {
			flushPending();

			const role: string = String(item.role || "user");
			let textParts: string[] = [];
			const prevPendingCount = pendingToolCalls.length;

			// Parse message.content for text AND embedded tool/function calls
			if (Array.isArray(item.content)) {
				for (const part of item.content) {
					if (!part || typeof part !== "object") {
						const s = safeStringify(part);
						if (s) textParts.push(s);
						continue;
					}
					// Textual segments
					if (typeof (part as any).text === "string") {
						textParts.push((part as any).text as string);
						continue;
					}
					if (typeof (part as any).content === "string") {
						textParts.push((part as any).content as string);
						continue;
					}
					// Embedded tool/function call variants
					if (
						((part as any).type === "tool_call" ||
							(part as any).type === "tool-use" ||
							(part as any).type === "tool_use" ||
							(part as any).type === "function_call") &&
						(((part as any).name as string) || (part as any).function?.name)
					) {
						const id = (part as any).id || (part as any).tool_call_id || (part as any).call_id || (part as any).callId || uuid();
						const name: string = (part as any).name ?? (part as any).function?.name ?? "unknown_tool";
						const rawArgs = (part as any).arguments ?? (part as any).input ?? (part as any).function?.arguments ?? {};
						const args = typeof rawArgs === "string" ? rawArgs : safeStringify(rawArgs) ?? "{}";
						pendingToolCalls.push({ id, type: "function", function: { name, arguments: args } });
						const callKey: string = String((part as any).callId || (part as any).call_id || (part as any).id || id);
						callKeyToId.set(callKey, id);
						continue;
					}
					// Fallback: stringify structured content
					const fallback = safeStringify((part as any).value ?? part);
					if (fallback) textParts.push(fallback);
				}
			} else {
				// Non-array content: best-effort stringify or pass through if string
				if (typeof item.content === "string") {
					textParts.push(item.content);
				} else {
					const s = safeStringify(item.content);
					if (s) textParts.push(s);
				}
			}

			const finalText = textParts.join("\n\n");
			if (role === "assistant") {
				// If this message contributed embedded tool calls, emit them together with remaining text
				if (pendingToolCalls.length > prevPendingCount) {
					results.push({
						role: "assistant",
						content: finalText.length ? finalText : null,
						tool_calls: pendingToolCalls,
					});
					pendingToolCalls = [];
				} else {
					results.push({ role: "assistant", content: finalText });
				}
			} else {
				// user | system | tool | function
				results.push({ role: role as CompletionRequest["role"], content: finalText });
			}
			continue;
		}

		// 2) Function/tool call variants -> batch into assistant.tool_calls
		if (type === "function_call" || type === "tool_call" || type === "hosted_tool_call" || type === "tool-use" || type === "tool_use") {
			const id: string = item.callId || item.call_id || item.id || item.tool_call_id || uuid();
			const name: string = item.name ?? item.function?.name ?? "unknown_tool";
			const rawArgs = item.arguments ?? item.input ?? item.function?.arguments ?? item.providerData?.arguments ?? {};
			const args: string = typeof rawArgs === "string" ? rawArgs : safeStringify(rawArgs) ?? "{}";

			pendingToolCalls.push({ id, type: "function", function: { name, arguments: args } });
			// Use the most stable key present in result items to map back
			const callKey: string = String(item.callId || item.call_id || item.id || id);
			callKeyToId.set(callKey, id);
			continue;
		}

		// 3) Function/tool result variants -> flush calls then add tool message
		if (type === "function_call_result" || type === "tool_result" || type === "tool-call-result" || type === "tool_call_result") {
			flushPending();

			const callKey: string = String(item.callId || item.call_id || item.tool_call_id || item.id || "");
			const mappedId = callKeyToId.get(callKey) || callKey || uuid();
			const content = extractTextFromToolOutput(item);
			results.push({ role: "tool", content, tool_call_id: mappedId });
			continue;
		}

		// 4) Fallback: unknown objects are stringified as a user message to preserve context
		flushPending();
		const fallback = safeStringify(item) ?? "";
		if (fallback) results.push({ role: "user", content: fallback });
	}

	flushPending();
	return results;
}

function safeStringify(value: unknown): string | undefined {
	try {
		if (typeof value === "string") return value;
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}

function inferFinishReason(responseLike: any): string | undefined {
	if (!responseLike || typeof responseLike !== "object") return undefined;
	// Prefer per-item message status if available
	const items: any[] = Array.isArray(responseLike.output) ? responseLike.output : [];
	const msg = items.find((i) => i && i.type === "message");
	if (msg?.status === "incomplete") return "length";
	if (msg?.status === "completed") return "stop";
	// Fall back to generic
	return undefined;
}

function extractModelParametersFromResponses(responseLike: any): Record<string, any> {
	if (!responseLike || typeof responseLike !== "object") return {};

	// Commonly surfaced parameters (best-effort — Responses API may not echo these back)
	const params: Record<string, any> = {};

	const assignIfPresent = (key: string, value: any) => {
		if (value !== undefined && value !== null) params[key] = value;
	};

	// Direct top-level in some SDKs
	assignIfPresent("temperature", responseLike.temperature);
	assignIfPresent("top_p", responseLike.top_p);
	assignIfPresent("max_tokens", responseLike.max_tokens ?? responseLike.max_output_tokens);
	assignIfPresent("presence_penalty", responseLike.presence_penalty);
	assignIfPresent("frequency_penalty", responseLike.frequency_penalty);
	assignIfPresent("stop", responseLike.stop);
	assignIfPresent("seed", responseLike.seed);
	assignIfPresent("tool_choice", responseLike.tool_choice);

	if (responseLike.tools && Array.isArray(responseLike.tools) && responseLike.tools.length) {
		assignIfPresent("tools", responseLike.tools);
	}

	// Structured outputs: Chat Completions (response_format) vs Responses API (text.format)
	if (responseLike.response_format) {
		assignIfPresent("response_format", responseLike.response_format);
	}
	if (responseLike.text && typeof responseLike.text === "object" && responseLike.text.format) {
		assignIfPresent("response_format", responseLike.text.format);
	}

	// Reasoning configs (if present)
	if (responseLike.reasoning && typeof responseLike.reasoning === "object") {
		assignIfPresent("reasoning", responseLike.reasoning);
	}

	return params;
}

function extractTextFromMessageContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!content) return "";
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const anyPart: any = part;
			if (typeof anyPart.text === "string") {
				parts.push(anyPart.text);
				continue;
			}
			if (typeof anyPart.content === "string") {
				parts.push(anyPart.content);
				continue;
			}
			const s = safeStringify(anyPart.value ?? anyPart);
			if (s) parts.push(s);
		}
		return parts.join("\n\n");
	}
	const s = safeStringify(content);
	return s ?? "";
}

function extractTextFromToolOutput(item: any): string {
	if (!item) return "";
	if (typeof item.output === "string") return item.output;
	if (item.output && typeof item.output === "object") {
		if (typeof item.output.text === "string") return item.output.text;
		const s = safeStringify(item.output.value ?? item.output);
		if (s) return s;
	}
	if (typeof item.text === "string") return item.text;
	const s = safeStringify(item);
	return s ?? "";
}
