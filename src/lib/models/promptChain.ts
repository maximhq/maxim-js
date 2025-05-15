import { Prompt } from "./prompt";
import { DeploymentVersionDeploymentConfig } from "./deployment";

export type PromptChain = {
	promptChainId: string;
	version: number;
	versionId: string;
	nodes: ({ order: number } & PromptNode)[];
};

export type PromptNode = {
	prompt: Prompt;
};
export type CodeBlockNode = {
	code: string;
};
export type ApiNode = {
	api: {
		url: string;
		method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
		params?: { id: string; key: string; value: string }[];
		headers?: { id: string; key: string; value: string }[];
		body?: string;
	};
};

export type Node = { order: number } & (PromptNode | CodeBlockNode | ApiNode);

export type PromptChainVersionConfig = {
	nodes: Node[];
};

export type PromptChainVersion = {
	id: string;
	version: number;
	promptChainId: string;
	description?: string;
	config?: PromptChainVersionConfig;
	createdAt: string;
	updatedAt: string;
};

export type PromptChainVersionsAndRules = {
	folderId: string;
	rules: DeploymentVersionDeploymentConfig;
	versions: PromptChainVersion[];
	fallbackVersion: PromptChainVersion | undefined;
};

export type MaximApiPromptChainResponse = {
	data: PromptChainVersionsAndRules;
	error?: { message: string };
};

export type MaximApiPromptChainsResponse = {
	data: ({ promptChainId: string } & PromptChainVersionsAndRules)[];
	error?: { message: string };
};
