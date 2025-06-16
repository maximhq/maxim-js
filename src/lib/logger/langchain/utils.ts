import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import {
	AIMessage,
	BaseMessage,
	isAIMessage,
	isBaseMessage,
	isChatMessage,
	isFunctionMessage,
	isHumanMessage,
	isSystemMessage,
	isToolMessage,
} from "@langchain/core/messages";
import { Generation, LLMResult } from "@langchain/core/outputs";

import { v4 as uuid } from "uuid";
import { ChatCompletionMessage, ChatCompletionResult, CompletionRequest } from "../../../../index";

type HandleLLMStartParameters = Parameters<NonNullable<BaseCallbackHandler["handleLLMStart"]>>;
type ExtraParams = HandleLLMStartParameters[4];
type Metadata = HandleLLMStartParameters[6];

export function parseLangchainModelAndParameters(metadata: Metadata, extraParams: ExtraParams) {
	let modelParams: Record<string, unknown> | undefined = (extraParams?.["invocation_params"] as Record<string, unknown>) || {};

	// bedrock returns inferenceConfig in extraParams
	if ("inferenceConfig" in modelParams && typeof modelParams["inferenceConfig"] === "object") {
		const { inferenceConfig, ...rest } = modelParams;
		modelParams = { ...inferenceConfig, ...rest };
	}

	let model = "unknown";
	if ("model_name" in modelParams) {
		model = modelParams["model_name"] as string;
		delete modelParams?.["model_name"];
	} else if ("model" in modelParams) {
		model = modelParams["model"] as string;
		delete modelParams?.["model"];
	} else if ("model_id" in modelParams) {
		model = modelParams["model_id"] as string;
		delete modelParams?.["model_id"];
	}

	if (model === "unknown") {
		if (metadata && "ls_model_name" in metadata && typeof metadata["ls_model_name"] === "string") {
			model = metadata["ls_model_name"];
		}
	}

	return [model, { ...modelParams }] as [string, Record<string, unknown>];
}

export function determineProvider(
	ids: string[],
	metadata?: Record<string, unknown>,
): "openai" | "bedrock" | "anthropic" | "huggingface" | "azure" | "together" | "groq" | "google" {
	const mapper = (param: string | string[]) => {
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

	const provider = mapper(ids);

	if (provider !== null) {
		return provider;
	}

	if (metadata && "ls_provider" in metadata && typeof metadata["ls_provider"] === "string") {
		const lsProvider = metadata["ls_provider"];
		const provider = mapper(lsProvider);

		if (provider !== null) {
			return provider;
		}
	}

	return "openai";
}

export function parseMessage(generation: Generation): any | undefined {
	if (!("message" in generation)) {
		return undefined;
	}
	const message = generation.message as BaseMessage;
	if (!message) {
		return undefined;
	}

	let toolCalls: any[] | undefined = undefined;
	if (isAIMessage(message)) {
		const aiMessage = new AIMessage(message);

		toolCalls = aiMessage["tool_calls"]?.map((toolCall) => {
			return {
				type: "function",
				id: toolCall.id,
				function: {
					name: toolCall.name,
					arguments: JSON.stringify(toolCall.args),
				},
			};
		});
	}

	return {
		role: "assistant",
		content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
		tool_calls: toolCalls,
		function_call: toolCalls,
	};
}

export function convertLLMResultToCompletionResult(result: LLMResult): ChatCompletionResult {
	let model = "unknown";

	if (result.generations.length === 0) {
		return {
			id: uuid(),
			object: "chat_completion",
			created: Math.floor(Date.now() / 1000),
			model,
			choices: [],
			usage: {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
			},
		};
	}

	let finishReason: string | undefined = "stop";
	if (result.llmOutput?.["stop_reason"]) {
		finishReason = result.llmOutput["stop_reason"]; // anthropic
	}

	const choices = result.generations[0].map((gen, index) => ({
		index,
		text: gen.text.trim() === "" ? undefined : gen.text.trim(),
		message: parseMessage(gen),
		logprobs: null,
		finish_reason: gen.generationInfo?.["finish_reason"] ?? finishReason,
	}));

	const [gen] = result.generations[0];

	if ("message" in gen) {
		const message = gen.message as BaseMessage;
		model = message.response_metadata?.["model_name"] ?? "unknown";
	}

	return {
		id: uuid(),
		object: choices?.[0]?.text ? "text_completion" : "chat_completion",
		created: Math.floor(Date.now() / 1000),
		model: model,
		choices,
		usage: parseTokenUsageForResult(result),
	};
}

export function parseTokenUsageForResult(result: LLMResult): {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
} {
	let usage = result.llmOutput?.["tokenUsage"];
	if (usage) {
		const promptTokens = usage.promptTokens ?? 0;
		const completionTokens = usage.completionTokens ?? 0;
		const totalTokens = promptTokens + completionTokens;
		return {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: totalTokens,
		};
	}

	const llm_usage = result.llmOutput?.["usage"];
	if (llm_usage) {
		if (llm_usage.input_tokens !== undefined) {
			usage = {
				prompt_tokens: llm_usage.input_tokens ?? 0,
				completion_tokens: llm_usage.output_tokens ?? 0,
				total_tokens: (llm_usage.input_tokens ?? 0) + (llm_usage.output_tokens ?? 0),
			};
		} else if (llm_usage.prompt_tokens !== undefined) {
			usage = {
				prompt_tokens: llm_usage.prompt_tokens ?? 0,
				completion_tokens: llm_usage.completion_tokens ?? 0,
				total_tokens: (llm_usage.prompt_tokens ?? 0) + (llm_usage.completion_tokens ?? 0),
			};
		}
	}

	if (usage) {
		return usage;
	}

	// Process individual generations if no top-level usage is found
	let prompt_tokens = 0;
	let output_tokens = 0;
	let total_tokens = 0;

	const generations = result.generations;
	if (generations) {
		for (const generation of generations) {
			for (const gen of generation) {
				const message = "message" in gen ? (gen.message as any) : undefined;
				const usage_data = message?.usage_metadata;
				if (usage_data) {
					if (usage_data.input_tokens !== undefined) {
						prompt_tokens += usage_data.input_tokens ?? 0;
						output_tokens += usage_data.output_tokens ?? 0;
						total_tokens += (usage_data.input_tokens ?? 0) + (usage_data.output_tokens ?? 0);
						continue;
					} else if (usage_data.prompt_tokens !== undefined) {
						prompt_tokens += usage_data.prompt_tokens ?? 0;
						output_tokens += usage_data.completion_tokens ?? 0;
						total_tokens += (usage_data.prompt_tokens ?? 0) + (usage_data.completion_tokens ?? 0);
						continue;
					}
				}

				const resp_metadata = message?.response_metadata;
				if (resp_metadata) {
					const metadata_usage = resp_metadata.usage;
					if (metadata_usage) {
						if (metadata_usage.input_tokens !== undefined) {
							prompt_tokens += metadata_usage.input_tokens ?? 0;
							output_tokens += metadata_usage.output_tokens ?? 0;
							total_tokens += (metadata_usage.input_tokens ?? 0) + (metadata_usage.output_tokens ?? 0);
							continue;
						} else if (metadata_usage.prompt_tokens !== undefined) {
							prompt_tokens += metadata_usage.prompt_tokens ?? 0;
							output_tokens += metadata_usage.completion_tokens ?? 0;
							total_tokens += (metadata_usage.prompt_tokens ?? 0) + (metadata_usage.completion_tokens ?? 0);
							continue;
						}
					}

					// Handle Amazon Bedrock case
					const bedrock_usage = resp_metadata["amazon-bedrock-invocationMetrics"];
					if (bedrock_usage) {
						prompt_tokens += bedrock_usage.inputTokenCount ?? 0;
						output_tokens += bedrock_usage.outputTokenCount ?? 0;
						total_tokens += (bedrock_usage.inputTokenCount ?? 0) + (bedrock_usage.outputTokenCount ?? 0);
					}
				}
			}
		}
	}

	return {
		prompt_tokens,
		completion_tokens: output_tokens,
		total_tokens,
	};
}

export function parseLangchainErrorToMaximError(error: unknown): {
	message: string;
	code?: string;
	type?: string;
} {
	if (error instanceof Error) {
		return {
			message: error.message,
			type: error.name,
			code: (error as any).code,
		};
	} else if (typeof error === "object" && error !== null) {
		const errorObj = error as Record<string, unknown>;
		return {
			message: String(errorObj["message"] || "Unknown error"),
			type: String(errorObj["type"] || errorObj["name"] || "Unknown"),
			code: errorObj["code"] ? String(errorObj["code"]) : undefined,
		};
	} else if (typeof error === "string") {
		return {
			message: error,
			type: "Unknown",
		};
	} else {
		return {
			message: "An unknown error occurred",
			type: "Unknown",
		};
	}
}

export function maybeParseJSON(input: string = "") {
	try {
		return JSON.parse(input);
	} catch (e) {
		return input;
	}
}

export function parseLangchainMessages(
	input: string[] | unknown[][],
	defaultRole: string = "user",
): (CompletionRequest | ChatCompletionMessage)[] {
	try {
		const messages: (CompletionRequest | ChatCompletionMessage)[] = [];
		if (Array.isArray(input[0])) {
			(input as unknown[][]).forEach((messageList) => {
				messageList.forEach((message) => {
					if (typeof message === "string") {
						return;
					}
					if (isBaseMessage(message)) {
						if (isSystemMessage(message)) {
							messages.push({ role: "system", content: message.content as unknown as CompletionRequest["content"] });
							return;
						}
					}
					if (isBaseMessage(message)) {
						if (isHumanMessage(message)) {
							messages.push({ role: "user", content: message.content as unknown as CompletionRequest["content"] });
							return;
						}
					}
					if (isBaseMessage(message)) {
						if (isAIMessage(message)) {
							// message.tool_calls
							messages.push({
								role: "assistant",
								content: message.content as unknown as ChatCompletionMessage["content"],
								tool_calls: message.tool_calls?.map((tc) => ({
									id: tc.id ?? "",
									type: tc.type ?? "",
									function: {
										name: tc.name,
										arguments: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args),
									},
								})),
							});
							return;
						}
					}
					if (isBaseMessage(message)) {
						if (isChatMessage(message)) {
							messages.push({
								role: "assistant",
								content: message.content as unknown as ChatCompletionMessage["content"],
							});
							return;
						}
					}
					if (isBaseMessage(message)) {
						if (isToolMessage(message)) {
							messages.push({
								role: "tool",
								content: message.content as unknown as CompletionRequest["content"],
								tool_call_id: message.tool_call_id,
							});
							return;
						}
					}
					if (isBaseMessage(message)) {
						if (isFunctionMessage(message)) {
							messages.push({
								role: "function",
								content: message.content as unknown as CompletionRequest["content"],
							});
							return;
						}
					}
					if (isBaseMessage(message)) {
						console.error(`[Maxim SDK] Invalid message type: ${message.getType()}`, { message });
					} else {
						console.error(`[Maxim SDK] Invalid message: The message is not of type BaseMessage`, { message });
					}
				});
			});
		} else {
			const delimiterToRole: Record<string, "user" | "assistant" | "system" | "tool" | "function"> = {
				System: "system",
				Human: "user",
				User: "user",
				Assistant: "assistant",
				Model: "assistant",
				Tool: "tool",
				Function: "function",
			};

			(input as string[]).forEach((message) => {
				if (typeof message !== "string") {
					console.error(`Invalid message type: ${typeof message}`);
					throw new Error(`Invalid message type: ${typeof message}`);
				}
				const pattern = /(System:|Human:|User:|Assistant:|Model:|Tool:|Function:)/;
				const splits = message.split(pattern).filter((s) => s.trim());
				for (let i = 0; i < splits.length; i += 2) {
					if (i + 1 < splits.length) {
						const delimiter = splits[i].replace(":", "").trim();
						const content = splits[i + 1].trim();
						messages.push({
							role: delimiterToRole[delimiter as keyof typeof delimiterToRole] || "user",
							content: maybeParseJSON(content),
						});
					} else {
						if (splits[i].indexOf(":") === -1) {
							messages.push({
								role: delimiterToRole[defaultRole as keyof typeof delimiterToRole] || "user",
								content: maybeParseJSON(splits[i]),
							});
						} else {
							const delimiter = splits[i].replace(":", "").trim();
							messages.push({
								role: delimiterToRole[delimiter as keyof typeof delimiterToRole] || "user",
								content: "",
							});
						}
					}
				}
			});
		}
		return messages;
	} catch (e) {
		console.error(`Error parsing messages: ${e}`);
		throw new Error(`Error parsing messages: ${e}`);
	}
}

export function parseLangchainTags(maximMetadataTags?: Record<string, string>, langchainTags?: string[]): Record<string, string> {
	const result: Record<string, string> = {
		...(maximMetadataTags ?? {}),
	};

	if (langchainTags) {
		langchainTags.forEach((tag) => {
			// Check for delimiters like ":" or "="
			let key: string;
			let value: string;

			if (tag.includes(":")) {
				const [tagKey, tagValue] = tag.split(":", 2);
				key = tagKey?.trim() || tag;
				value = tagValue?.trim() || "From MaximLangchainTracer";
			} else if (tag.includes("=")) {
				const [tagKey, tagValue] = tag.split("=", 2);
				key = tagKey?.trim() || tag;
				value = tagValue?.trim() || "From MaximLangchainTracer";
			} else {
				// No delimiter found, use tag as key with default value
				key = tag;
				value = "From MaximLangchainTracer";
			}

			result[key] = value;
		});
	}

	return result;
}

export function addParsedTagsToLogger(tags: string[] | undefined, addTagFunction: (tag: string, value: string) => void): void {
	if (!tags) return;

	const parsedTags = parseLangchainTags(undefined, tags);
	Object.entries(parsedTags).forEach(([key, value]) => {
		addTagFunction(key, value);
	});
}
