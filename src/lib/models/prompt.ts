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

export type Prompt = {
	promptId: string;
	version: number;
	versionId: string;
	messages: { role: string; content: string | CompletionRequestContent[] }[];
	modelParameters: { [key: string]: any };
	model: string;
	provider: string;
	tags: PromptTags;
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
