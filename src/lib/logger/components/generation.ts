import { ChatCompletionMessage, CompletionRequest, CompletionRequestContent } from "../../models/prompt";
import { uniqueId, utcNow } from "../utils";
import { LogWriter } from "../writer";
import { Attachment } from "./attachment";
import { EvaluatableBaseContainer } from "./base";
import { Entity } from "./types";

export interface GenerationError {
	message: string;
	code?: string;
	type?: string;
}

export interface ChatCompletionResult {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<ChatCompletionChoice>;
	usage: Usage;
	error?: GenerationError;
}

export interface TextCompletionResult {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<TextCompletionChoice>;
	usage: Usage;
	error?: GenerationError;
}

interface Logprobs {
	text_offset?: Array<number>;
	token_logprobs?: Array<number>;
	tokens?: Array<string>;
	top_logprobs?: Array<Record<string, number>>;
}

interface ChatCompletionChoice {
	index: number;
	message: ChatCompletionMessage;
	logprobs: Logprobs | null;
	finish_reason: string;
}

interface TextCompletionChoice {
	index: number;
	text: string;
	logprobs: Logprobs | null;
	finish_reason: string;
}

interface Usage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

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

export class Generation extends EvaluatableBaseContainer {
	private model?: string;
	private provider?: string;
	private maximPromptId?: string;
	private modelParameters?: Record<string, any>;

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

	public setModel(model: string) {
		this.model = model;
		this.commit("update", { model });
	}

	public static setModel_(writer: LogWriter, id: string, model: string) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "update", { model });
	}

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

	public setModelParameters(modelParameters: Record<string, any>) {
		this.commit("update", { modelParameters });
	}

	public static setModelParameters_(writer: LogWriter, id: string, modelParameters: Record<string, any>) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "update", { modelParameters });
	}

	public result(result: TextCompletionResult | ChatCompletionResult) {
		this.commit("result", { result });
		this.end();
	}

	public static result_(writer: LogWriter, id: string, result: TextCompletionResult | ChatCompletionResult) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "result", { result });
		EvaluatableBaseContainer.end_(writer, Entity.GENERATION, id, { endTimestamp: utcNow() });
	}

	public error(error: GenerationError) {
		this.commit("result", { result: { error: error, id: uniqueId() } });
		this.end();
	}

	public static error_(writer: LogWriter, id: string, error: GenerationError) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "result", { result: { error: error, id: uniqueId() } });
		EvaluatableBaseContainer.end_(writer, Entity.GENERATION, id, { endTimestamp: utcNow() });
	}

	public addAttachment(attachment: Attachment) {
		this.commit("upload-attachment", attachment);
	}

	public static addAttachment_(writer: LogWriter, id: string, attachment: Attachment) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "upload-attachment", attachment);
	}

	public static override end_(writer: LogWriter, id: string, data?: any) {
		EvaluatableBaseContainer.end_(writer, Entity.GENERATION, id, data);
	}

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

/**
 * Parses attachments from messages and returns modified messages with extracted attachments
 * Similar to Python's parse_attachments_from_messages function
 */
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
