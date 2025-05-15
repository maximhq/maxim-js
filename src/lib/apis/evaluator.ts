import { type MaximAPIEvaluatorFetchResponse } from "../models/evaluator";
import { ExtractAPIDataType } from "../utils/utils";
import { MaximAPI } from "./maxim";

export class MaximEvaluatorAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string) {
		super(baseUrl, apiKey);
	}

	public async fetchPlatformEvaluator(name: string, inWorkspaceId: string): Promise<ExtractAPIDataType<MaximAPIEvaluatorFetchResponse>> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIEvaluatorFetchResponse>(`/api/sdk/v1/evaluators?name=${name}&workspaceId=${inWorkspaceId}`)
				.then((response) => {
					if ("error" in response) {
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
