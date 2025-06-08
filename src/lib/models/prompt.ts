import { DeploymentVersionDeploymentConfig } from "./deployment";

export type PromptTags = {
	[key: string]: string | number | boolean | undefined;
};

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

export type ImageUrl = CompletionRequestImageUrlContent["image_url"];

export type FunctionCall = {
	name: string;
	arguments: string;
};

export type ToolCall = {
	id: string;
	type: string;
	function: FunctionCall;
};

export type Message = {
	role: string;
	content: string;
	toolCalls?: ToolCall[];
};

export type Choice = {
	index: number;
	message: Message;
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
	messages: { role: string; content: string | CompletionRequestContent[] }[];
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
