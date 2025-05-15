import { type MaximApiPromptResponse, type MaximApiPromptsResponse, type PromptVersionsAndRules } from "../models/prompt";
import { MaximAPI } from "./maxim";

export class MaximPromptAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string) {
		super(baseUrl, apiKey);
	}

	public async getPrompt(id: string): Promise<PromptVersionsAndRules> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximApiPromptResponse>(`/api/sdk/v4/prompts?promptId=${id}`)
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

	public async getPrompts(): Promise<({ promptId: string } & PromptVersionsAndRules)[]> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximApiPromptsResponse>(`/api/sdk/v4/prompts`)
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
