import {
	type DatasetEntry,
	type DatasetRow,
	type MaximAPIDatasetResponse,
	type MaximAPIDatasetStructureResponse,
	type MaximAPIDatasetTotalRowsResponse,
} from "../models/dataset";
import { type MaximAPIResponse } from "../models/deployment";
import { MaximAPI } from "./maxim";

export class MaximDatasetAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string, isDebug?: boolean) {
		super(baseUrl, apiKey, isDebug);
	}

	public async addDatasetEntries(datasetId: string, datasetEntries: DatasetEntry[]): Promise<void> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIResponse>(`/api/sdk/v3/datasets/entries`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ datasetId, entries: datasetEntries }),
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

	public async getDatasetTotalRows(datasetId: string): Promise<number> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIDatasetTotalRowsResponse>(`/api/sdk/v1/datasets/total-rows?datasetId=${datasetId}`)
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

	public async getDatasetRow(datasetId: string, rowIndex: number): Promise<{ data: DatasetRow; id: string }> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIDatasetResponse>(`/api/sdk/v2/datasets/row?datasetId=${datasetId}&row=${rowIndex}`)
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

	public async getDatasetDatastructure(datasetId: string): Promise<Record<string, "INPUT" | "EXPECTED_OUTPUT" | "VARIABLE">> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIDatasetStructureResponse>(`/api/sdk/v1/datasets/structure?datasetId=${datasetId}`)
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
