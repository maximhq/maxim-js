import { ChatCompletionMessage, CompletionRequest, CompletionRequestContent } from "../../models/prompt";
import { uniqueId, utcNow } from "../utils";
import { LogWriter } from "../writer";
import type { Attachment } from "../../types";
import { EvaluatableBaseContainer } from "./base";
import { Entity } from "./types";

/**
 * Represents an error that occurred during LLM generation.
 */
export interface GenerationError {
	message: string;
	code?: string;
	type?: string;
}

/**
 * Represents the result of an LLM chat completion.
 */
export interface ChatCompletionResult {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<ChatCompletionChoice>;
	usage: Usage;
	error?: GenerationError;
}

/**
 * Represents the result of an LLM text completion.
 */
export interface TextCompletionResult {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<TextCompletionChoice>;
	usage: Usage;
	error?: GenerationError;
}

export interface Logprobs {
	text_offset?: Array<number>;
	token_logprobs?: Array<number>;
	tokens?: Array<string>;
	top_logprobs?: Array<Record<string, number>>;
}

export interface ChatCompletionChoice {
	index: number;
	message: ChatCompletionMessage;
	logprobs: Logprobs | null;
	finish_reason: string;
}

export interface TextCompletionChoice {
	index: number;
	text: string;
	logprobs: Logprobs | null;
	finish_reason: string;
}

/**
 * Token usage statistics for a generation request.
 */
export interface Usage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

/**
 * Configuration object for generation.
 */
export type GenerationConfig = {
	id: string;
	name?: string;
	provider: "openai" | "bedrock" | "anthropic" | "huggingface" | "azure" | "together" | "groq" | "google";
	model: string;
	maximPromptId?: string;
	messages: (CompletionRequest | ChatCompletionMessage)[];
	modelParameters: Record<string, any>;
	tags?: Record<string, string>;
};

/**
 * Represents an LLM generation or completion.
 *
 * The Generation class tracks the complete lifecycle of LLM requests,
 * including input messages, model parameters, results, and any errors.
 * It supports both chat and text completion formats.
 *
 * @class Generation
 * @extends EvaluatableBaseContainer
 * @example
 * const generation = container.generation({
 *   id: 'gen-001',
 *   name: 'User Query Response',
 *   provider: 'openai',
 *   model: 'gpt-4',
 *   messages: [
 *     { role: 'system', content: 'You are a helpful assistant.' },
 *     { role: 'user', content: 'What is the capital of France?' }
 *   ],
 *   modelParameters: { temperature: 0.7, max_tokens: 150 }
 * });
 *
 * // Record the result
 * generation.result({
 *   id: 'cmpl-123',
 *   object: 'chat.completion',
 *   created: Date.now(),
 *   model: 'gpt-4',
 *   choices: [{
 *     index: 0,
 *     message: { role: 'assistant', content: 'The capital of France is Paris.' },
 *     finish_reason: 'stop',
 *     logprobs: null
 *   }],
 *   usage: { prompt_tokens: 25, completion_tokens: 8, total_tokens: 33 }
 * });
 */
export class Generation extends EvaluatableBaseContainer {
	private model?: string;
	private provider?: string;
	private maximPromptId?: string;
	private modelParameters?: Record<string, any>;

	/**
	 * Creates a new generation log entry.
	 *
	 * @param config - Configuration object defining the generation
	 * @param writer - Log writer instance for persisting generation data
	 * @example
	 * const generation = container.generation({
	 *   id: 'response-gen-001',
	 *   name: 'Customer Query Response',
	 *   provider: 'openai',
	 *   model: 'gpt-4',
	 *   messages: [
	 *     { role: 'system', content: 'You are a helpful assistant.' },
	 *     { role: 'user', content: 'How do I reset my password?' }
	 *   ],
	 *   modelParameters: { temperature: 0.7, max_tokens: 200 }
	 * });
	 */
	constructor(config: GenerationConfig, writer: LogWriter) {
		// Extract attachments from messages before calling super constructor
		const [processedMessages, attachments] = parseAttachmentsFromMessages(config.messages);

		// Create modified config with processed messages
		const processedConfig = {
			...config,
			messages: processedMessages,
		};

		super(Entity.GENERATION, processedConfig, writer);
		this.model = config.model;
		this.provider = config.provider;
		this.maximPromptId = config.maximPromptId;
		this.modelParameters = config.modelParameters;

		// Add extracted attachments
		for (const attachment of attachments) {
			this.addAttachment(attachment);
		}
	}

	/**
	 * Updates the model being used for this generation.
	 *
	 * @param model - The new model name or identifier
	 * @returns void
	 * @example
	 * generation.setModel('gpt-4-turbo');
	 */
	public setModel(model: string) {
		this.model = model;
		this.commit("update", { model });
	}

	/**
	 * Static method to update the model for any generation by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The generation ID
	 * @param model - The new model name
	 * @returns void
	 */
	public static setModel_(writer: LogWriter, id: string, model: string) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "update", { model });
	}

	/**
	 * Adds additional messages to this generation's conversation.
	 *
	 * @param messages - Array of messages to add
	 * @returns void
	 * @example
	 * generation.addMessages([
	 *   { role: 'user', content: 'Can you clarify that?' },
	 * ]);
	 */
	public addMessages(messages: (CompletionRequest | ChatCompletionMessage)[]) {
		// Extract attachments from messages
		const [processedMessages, attachments] = parseAttachmentsFromMessages(messages);

		// Add the processed messages
		this.commit("update", { messages: processedMessages });

		// Add extracted attachments
		for (const attachment of attachments) {
			this.addAttachment(attachment);
		}
	}

	/**
	 * Static method to add messages to any generation by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The generation ID
	 * @param messages - Array of messages to add
	 * @returns void
	 */
	public static addMessages_(writer: LogWriter, id: string, messages: (CompletionRequest | ChatCompletionMessage)[]) {
		// Extract attachments from messages
		const [processedMessages, attachments] = parseAttachmentsFromMessages(messages);

		// Add the processed messages
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "update", { messages: processedMessages });

		// Add extracted attachments
		for (const attachment of attachments) {
			Generation.addAttachment_(writer, id, attachment);
		}
	}

	/**
	 * Updates the model parameters for this generation.
	 *
	 * @param modelParameters - Object containing model-specific parameters
	 * @returns void
	 * @example
	 * generation.setModelParameters({
	 *   temperature: 0.9,
	 *   max_tokens: 500,
	 *   top_p: 0.95,
	 *   frequency_penalty: 0.2
	 * });
	 */
	public setModelParameters(modelParameters: Record<string, any>) {
		this.commit("update", { modelParameters });
	}

	/**
	 * Static method to update model parameters for any generation by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The generation ID
	 * @param modelParameters - Model parameters to update
	 * @returns void
	 */
	public static setModelParameters_(writer: LogWriter, id: string, modelParameters: Record<string, any>) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "update", { modelParameters });
	}

	/**
	 * Records the successful result of this generation and ends it.
	 *
	 * @param result - The completion result from the LLM
	 * @returns void
	 * @example
	 * generation.result({
	 *   id: 'cmpl-123',
	 *   object: 'chat.completion',
	 *   created: Date.now(),
	 *   model: 'gpt-4',
	 *   choices: [{
	 *     index: 0,
	 *     message: { role: 'assistant', content: 'Here is the answer...' },
	 *     finish_reason: 'stop',
	 *     logprobs: null
	 *   }],
	 *   usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 }
	 * });
	 */
	public result(result: TextCompletionResult | ChatCompletionResult) {
		this.commit("result", { result });
		this.end();
	}

	/**
	 * Static method to record a result for any generation by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The generation ID
	 * @param result - The completion result
	 * @returns void
	 */
	public static result_(writer: LogWriter, id: string, result: TextCompletionResult | ChatCompletionResult) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "result", { result });
		EvaluatableBaseContainer.end_(writer, Entity.GENERATION, id, { endTimestamp: utcNow() });
	}

	/**
	 * Records an error that occurred during this generation.
	 *
	 * @param error - Error information including message, code, and type
	 * @returns void
	 * @example
	 * generation.error({
	 *   message: 'API request timed out',
	 *   code: 'TIMEOUT_ERROR',
	 *   type: 'NetworkError'
	 * });
	 */
	public error(error: GenerationError) {
		this.commit("result", { result: { error: error, id: uniqueId() } });
		this.end();
	}

	/**
	 * Static method to record an error for any generation by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The generation ID
	 * @param error - Error information
	 * @returns void
	 */
	public static error_(writer: LogWriter, id: string, error: GenerationError) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "result", { result: { error: error, id: uniqueId() } });
		EvaluatableBaseContainer.end_(writer, Entity.GENERATION, id, { endTimestamp: utcNow() });
	}

	/**
	 * Adds an attachment to this generation (can be of type `file`, `data`, or `url`).
	 *
	 * @param attachment - The attachment to add (file, data, or URL)
	 * @returns void
	 * @example
	 * generation.addAttachment({
	 *   id: 'input-document',
	 *   type: 'file',
	 *   path: './uploads/user_document.pdf',
	 *   name: 'User Document'
	 * });
	 */
	public addAttachment(attachment: Attachment) {
		this.commit("upload-attachment", attachment);
	}

	/**
	 * Static method to add an attachment to any generation by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The generation ID
	 * @param attachment - The attachment to add
	 * @returns void
	 */
	public static addAttachment_(writer: LogWriter, id: string, attachment: Attachment) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "upload-attachment", attachment);
	}

	/**
	 * Returns the complete data representation of this generation.
	 *
	 * @returns Generation data.
	 * @example
	 * const genData = generation.data();
	 */
	public override data(): any {
		return {
			...super.data(),
			provider: this.provider,
			model: this.model,
			maximPromptId: this.maximPromptId,
			modelParameters: this.modelParameters,
		};
	}
}

function parseAttachmentsFromMessages(
	messages: (CompletionRequest | ChatCompletionMessage)[],
): [(CompletionRequest | ChatCompletionMessage)[], Attachment[]] {
	const attachments: Attachment[] = [];
	const modifiedMessages: (CompletionRequest | ChatCompletionMessage)[] = [];

	for (const message of messages) {
		const content = message.content;

		// Determine attachedTo value based on message role
		const attachedTo = message.role === "assistant" ? "output" : "input";

		// If content is a string, no attachments to extract
		if (typeof content === "string") {
			modifiedMessages.push(message);
			continue;
		}

		// Handle array content (multimodal)
		if (Array.isArray(content)) {
			const filteredContent: Array<CompletionRequestContent> = [];

			for (const item of content) {
				if (typeof item === "string") {
					// Convert string items to text content objects
					filteredContent.push({ type: "text", text: item });
					continue;
				}

				if (item.type === "image_url") {
					const imageUrl = item.image_url.url;

					if (imageUrl) {
						// Check if it's a base64 encoded data URI
						if (imageUrl.startsWith("data:image")) {
							// Extract base64 data from data URI
							const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
							if (match) {
								const ext = match[1];
								const base64Data = match[2];

								try {
									// Convert base64 to binary data
									const binaryData = atob(base64Data);
									const bytes = new Uint8Array(binaryData.length);
									for (let i = 0; i < binaryData.length; i++) {
										bytes[i] = binaryData.charCodeAt(i);
									}

									const attachment: Attachment = {
										type: "fileData",
										id: uniqueId(),
										name: `image.${ext}`,
										data: Buffer.from(bytes),
										mimeType: `image/${ext}`,
										tags: { attachedTo: attachedTo },
									};
									attachments.push(attachment);
								} catch (error) {
									console.error("[MaximSDK] Error while parsing base64 attachment:", error);
									// Keep the image content if parsing fails
									filteredContent.push(item);
								}
							} else {
								// Keep the image content if regex doesn't match
								filteredContent.push(item);
							}
						} else {
							// For regular URLs, create URL attachment
							const attachment: Attachment = {
								type: "url",
								id: uniqueId(),
								url: imageUrl,
								mimeType: "image/*",
								tags: { attachedTo: attachedTo },
							};
							attachments.push(attachment);
						}

						// Note: We remove the image content from the message since it's now an attachment
					}
				} else {
					// Keep other content types (text, etc.)
					filteredContent.push(item);
				}
			}

			// Convert the filtered content back to a string if it only contains text
			if (filteredContent.length === 1 && filteredContent[0].type === "text") {
				modifiedMessages.push({
					...message,
					content: filteredContent[0].text,
				});
			} else if (filteredContent.length === 0) {
				// If all content was images, keep an empty string
				modifiedMessages.push({
					...message,
					content: "",
				});
			} else {
				// Keep as array if multiple content items or non-text items
				modifiedMessages.push({
					...message,
					content: filteredContent,
				} as CompletionRequest);
			}
		} else {
			// Fallback for any other content type
			modifiedMessages.push(message);
		}
	}

	return [modifiedMessages, attachments];
}
