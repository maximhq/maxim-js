import { DeploymentVersionDeploymentConfig } from "./deployment";

export type PromptTags = {
	[key: string]: string | number | boolean | undefined;
};

interface ToolCallFunction {
	arguments: string;
	name: string;
}

interface ToolCall {
	id: string;
	function: ToolCallFunction;
	type: string;
}

/**
 * Represents a message in a chat completion response from an AI model.
 *
 * Contains the assistant's response including the content, role, and optional
 * function/tool call information. Used in chat-based AI interactions where
 * the model responds as an assistant in a conversation.
 *
 * @interface ChatCompletionMessage
 * @property role - Always "assistant" for response messages
 * @property content - The text content of the response, or null if using function calls
 * @property function_call - Legacy function call information (deprecated in favor of tool_calls)
 * @property tool_calls - Array of tool/function calls made by the assistant
 * @example
 * // Simple text response
 * const message: ChatCompletionMessage = {
 *   role: "assistant",
 *   content: "Hello! How can I help you today?"
 * };
 *
 * @example
 * // Response with tool calls
 * const toolMessage: ChatCompletionMessage = {
 *   role: "assistant",
 *   content: null,
 *   tool_calls: [{
 *     id: "call_123",
 *     type: "function",
 *     function: {
 *       name: "get_weather",
 *       arguments: '{"location": "San Francisco"}'
 *     }
 *   }]
 * };
 */
export interface ChatCompletionMessage {
	role: "assistant";
	content: string | null;
	function_call?: ToolCallFunction;
	tool_calls?: Array<ToolCall>;
}

export type CompletionRequestTextContent = {
	type: "text";
	text: string;
};

/**
 * Represents an image URL with optional detail level for vision-enabled models.
 *
 * @property type - Content type identifier
 * @property image_url - Image URL configuration
 * @property image_url.url - The URL or base64-encoded image data
 * @property image_url.detail - Level of detail for image processing ("low", "high", "auto")
 */
export type CompletionRequestImageUrlContent = {
	type: "image_url";
	image_url: {
		url: string;
		detail?: string;
	};
};

export type CompletionRequestContent = CompletionRequestTextContent | CompletionRequestImageUrlContent;

/**
 * Represents a message in a completion request to an AI model.
 *
 * Defines the structure for input messages sent to AI models, supporting
 * different roles (user, system, tool, function) and content types including
 * text and images for vision-enabled models.
 *
 * @interface CompletionRequest
 * @property role - The role of the message sender
 * @property content - Message content as text or multimodal array
 * @property tool_call_id - ID of the tool call this message responds to (for tool/function roles)
 * @example
 * // Simple user message
 * const userMessage: CompletionRequest = {
 *   role: "user",
 *   content: "What's the weather like today?"
 * };
 *
 * @example
 * // System message with instructions
 * const systemMessage: CompletionRequest = {
 *   role: "system",
 *   content: "You are a helpful weather assistant. Provide accurate forecasts."
 * };
 *
 * @example
 * // Multimodal message with text and image
 * const visionMessage: CompletionRequest = {
 *   role: "user",
 *   content: [
 *     { type: "text", text: "What do you see in this image?" },
 *     {
 *       type: "image_url",
 *       image_url: {
 *         url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA...", // Base64 encoded image data
 *         detail: "high"
 *       }
 *     }
 *   ]
 * };
 *
 * @example
 * // Tool response message
 * const toolResponse: CompletionRequest = {
 *   role: "tool",
 *   content: '{"temperature": 72, "condition": "sunny"}',
 *   tool_call_id: "call_123"
 * };
 */
export interface CompletionRequest {
	role: "user" | "system" | "tool" | "function";
	content: string | Array<CompletionRequestContent>;
	tool_call_id?: string;
}

/**
 * Type alias for image URL configuration used in vision requests.
 *
 * @see {@link CompletionRequestImageUrlContent} For the full image content structure
 */
export type ImageUrl = CompletionRequestImageUrlContent["image_url"];

/**
 * Represents a single choice/response option from an AI model completion.
 *
 * Contains the generated message, its position in the response array, and
 * the reason why generation finished (e.g., natural stop, length limit).
 *
 * @property index - Zero-based index of this choice in the response array
 * @property message - The generated assistant message
 * @property finishReason - Reason generation stopped ("stop", "length", "function_call", "tool_calls", etc.)
 * @example
 * const choice: Choice = {
 *   index: 0,
 *   message: {
 *     role: "assistant",
 *     content: "The weather in San Francisco is sunny and 72°F."
 *   },
 *   finishReason: "stop"
 * };
 */
export type Choice = {
	index: number;
	message: ChatCompletionMessage;
	finishReason: string;
};

export type Usage = {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	latency: number;
};

/**
 * Complete response object from a prompt execution.
 *
 * Contains the full response from an AI model including all generated choices,
 * usage statistics, model information, and configuration parameters used.
 * This is the primary response format returned by prompt execution methods.
 *
 * @property id - Unique identifier for this response
 * @property provider - AI provider name (e.g., "openai", "anthropic", "azure")
 * @property model - Specific model used (e.g., "gpt-4", "claude-3-sonnet")
 * @property choices - Array of generated response choices
 * @property usage - Token usage and latency information
 * @property modelParams - Model parameters used for generation
 * @example
 * // Typical prompt response
 * const response: PromptResponse = {
 *   id: "chatcmpl-123",
 *   provider: "openai",
 *   model: "gpt-4",
 *   choices: [{
 *     index: 0,
 *     message: {
 *       role: "assistant",
 *       content: "Hello! How can I help you today?"
 *     },
 *     finishReason: "stop"
 *   }],
 *   usage: {
 *     promptTokens: 12,
 *     completionTokens: 9,
 *     totalTokens: 21,
 *     latency: 1200
 *   },
 *   modelParams: {
 *     temperature: 0.7,
 *     max_tokens: 1000
 *   }
 * };
 *
 * @example
 * // Using the response
 * const content = response.choices[0].message.content;
 * console.log(`Generated: ${content}`);
 * console.log(`Used ${response.usage.totalTokens} tokens`);
 */
export type PromptResponse = {
	id: string;
	provider: string;
	model: string;
	choices: Choice[];
	usage: Usage;
	modelParams: { [key: string]: any };
};

export type Prompt = {
	promptId: string;
	version: number;
	versionId: string;
	messages: (CompletionRequest | ChatCompletionMessage)[];
	modelParameters: { [key: string]: any };
	model: string;
	provider: string;
	tags: PromptTags;
	run: (input: string, options?: { imageUrls?: ImageUrl[]; variables?: { [key: string]: string } }) => Promise<PromptResponse>;
};

export type PromptTagValues = {
	[key: string]: string | number | boolean | undefined;
};

export type PromptVersionConfig = {
	id: string;
	messages: { role: string; content: string }[];
	modelParameters: { [key: string]: any };
	model: string;
	provider: string;
	tags?: PromptTagValues;
};

export type PromptVersion = {
	id: string;
	version: number;
	promptId: string;
	description?: string;
	config?: PromptVersionConfig;
	createdAt: string;
	updatedAt: string;
};

export type PromptVersionsAndRules = {
	folderId: string;
	rules: DeploymentVersionDeploymentConfig;
	versions: PromptVersion[];
	fallbackVersion: PromptVersion | undefined;
};

export type MaximApiPromptResponse = {
	data: PromptVersionsAndRules;
	error?: { message: string };
};

export type MaximApiPromptsResponse = {
	data: ({ promptId: string } & PromptVersionsAndRules)[];
	error?: { message: string };
};

export type MaximApiPromptRunResponse = {
	data: PromptResponse;
	error?: { message: string };
};
