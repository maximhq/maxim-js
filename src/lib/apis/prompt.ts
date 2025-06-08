import {
	type MaximApiPromptResponse,
	type MaximApiPromptsResponse,
	type PromptVersionsAndRules,
	type MaximApiPromptRunResponse,
	type PromptResponse,
	type ImageUrl,
} from "../models/prompt";
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

	public async runPromptVersion(
		promptVersionId: string,
		input: string,
		options?: { imageUrls?: ImageUrl[]; variables?: { [key: string]: string } },
	): Promise<PromptResponse> {
		return new Promise((resolve, reject) => {
			const payload: {
				type: string;
				promptVersionId: string;
				input: string;
				variables: { [key: string]: string };
				imageUrls?: ImageUrl[];
			} = {
				type: "maxim",
				promptVersionId,
				input,
				variables: options?.variables || {},
			};

			if (options?.imageUrls) {
				payload.imageUrls = options.imageUrls;
			}

			this.fetch<MaximApiPromptRunResponse>("/api/sdk/v4/prompts/run", {
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
