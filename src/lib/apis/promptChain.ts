import {
	type MaximApiPromptChainResponse,
	type MaximApiPromptChainsResponse,
	type PromptChainVersionsAndRules,
	type MaximApiAgentRunResponse,
	type AgentResponse,
} from "../models/promptChain";
import { MaximAPI } from "./maxim";

export class MaximPromptChainAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string) {
		super(baseUrl, apiKey);
	}

	public async getPromptChain(id: string): Promise<PromptChainVersionsAndRules> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximApiPromptChainResponse>(`/api/sdk/v4/prompt-chains?promptChainId=${id}`)
				.then((response) => {
					if (response.error) {
						reject(response.error);
					} else {
						resolve(response.data);
					}
				})
				.catch((error) => {
					reject(error);
				});
		});
	}

	public async getPromptChains(): Promise<({ promptChainId: string } & PromptChainVersionsAndRules)[]> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximApiPromptChainsResponse>(`/api/sdk/v4/prompt-chains`)
				.then((response) => {
					if (response.error) {
						reject(response.error);
					} else {
						resolve(response.data);
					}
				})
				.catch((error) => {
					reject(error);
				});
		});
	}

	public async runPromptChainVersion(
		promptChainVersionId: string,
		input: string,
		options?: { variables?: { [key: string]: string } },
	): Promise<AgentResponse> {
		return new Promise((resolve, reject) => {
			const payload = {
				versionId: promptChainVersionId,
				input,
				variables: options?.variables || {},
			};

			this.fetch<MaximApiAgentRunResponse>("/api/sdk/v4/agents/run", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			})
				.then((response) => {
					if (response.error) {
						reject(new Error(response.error.message));
					} else {
						resolve(response.data);
					}
				})
				.catch((error) => {
					reject(error);
				});
		});
	}
}
