import { type Folder, type MaximFolderResponse, type MaximFoldersResponse } from "../models/folder";
import { MaximAPI } from "./maxim";

export class MaximFolderAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string) {
		super(baseUrl, apiKey);
	}

	public async getFolder(id: string): Promise<Folder> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximFolderResponse>(`/api/sdk/v3/folders?folderId=${id}`)
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

	public async getFolders(): Promise<Folder[]> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximFoldersResponse>(`/api/sdk/v3/folders`)
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
