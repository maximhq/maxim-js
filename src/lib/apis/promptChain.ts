import {
	type MaximApiPromptChainResponse,
	type MaximApiPromptChainsResponse,
	type PromptChainVersionsAndRules,
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
}
