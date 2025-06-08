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

export type CompletionRequestImageUrlContent = {
	type: "image_url";
	image_url: {
		url: string;
		detail?: string;
	};
};

export type CompletionRequestContent = CompletionRequestTextContent | CompletionRequestImageUrlContent;

export interface CompletionRequest {
	role: "user" | "system" | "tool" | "function";
	content: string | Array<CompletionRequestContent>;
	tool_call_id?: string;
}

export type ImageUrl = CompletionRequestImageUrlContent["image_url"];

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
