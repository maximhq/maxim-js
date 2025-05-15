import { type MaximAPIResponse } from "../models/deployment";
import { MaximAPILogCheckAttachEvaluatorsResponse } from "../models/logger";
import { MaximAPI } from "./maxim";

export class MaximLogsAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string) {
		super(baseUrl, apiKey);
	}

	public async doesLogRepositoryExist(loggerId: string): Promise<boolean> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIResponse>(`/api/sdk/v3/log-repositories?loggerId=${loggerId}`)
				.then((response) => {
					if (response.error) {
						resolve(false);
					} else {
						resolve(true);
					}
				})
				.catch((error) => {
					reject(error);
				});
		});
	}

	public async checkAttachEvaluators(
		repositoryId: string,
		evaluatorNames: string[],
	): Promise<{ canAttach: boolean; message?: string; evaluatorsToIgnore?: string[] }> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPILogCheckAttachEvaluatorsResponse>(`/api/sdk/v1/log-repositories/check-attach-evaluators`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					repoId: repositoryId,
					evaluatorNames: evaluatorNames,
				}),
			})
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

	public async pushLogs(repositoryId: string, logs: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIResponse>(`/api/sdk/v3/log?id=${repositoryId}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: logs,
			})
				.then((response) => {
					if (response.error) {
						reject(response.error);
					} else {
						resolve();
					}
				})
				.catch((error) => {
					reject(error);
				});
		});
	}
}
