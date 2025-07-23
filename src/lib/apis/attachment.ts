import { MaximAPISignedURLResponse } from "../models/attachment";
import { MaximAPI } from "./maxim";

export class MaximAttachmentAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string, isDebug?: boolean) {
		super(baseUrl, apiKey, isDebug);
	}

	public async getUploadUrl(
		key: string,
		mimeType: string,
		size: number,
	): Promise<Extract<MaximAPISignedURLResponse, { data: unknown }>["data"]> {
		const response = await this.fetch<MaximAPISignedURLResponse>(
			`/api/sdk/v1/log-repositories/attachments/upload-url?key=${key}&mimeType=${mimeType}&size=${size}`,
		);

		if ("error" in response) {
			throw response.error;
		}

		return response.data;
	}

	public async uploadToSignedUrl(url: string, data: Buffer, mimeType: string): Promise<void> {
		const response = await this.axiosInstance.put(url, data, {
			headers: {
				"Content-Type": mimeType,
				"Content-Length": data.length.toString(),
			},
			responseType: "text",
			timeout: 120000, // 2 minute timeout for large file uploads
			// Don't transform the request/response to preserve binary data
			transformRequest: [(data: Buffer) => data],
			transformResponse: [(data: unknown) => data],
			// Override base URL since this is a direct call to signed URL
			baseURL: "",
		});

		// Success - axios retry already handled any retryable errors
		if (response.status >= 200 && response.status < 300) {
			return;
		}

		// This shouldn't happen due to axios retry, but just in case
		if (response.data && typeof response.data === "object" && "error" in response.data) {
			throw response.data.error;
		}
		throw response.data;
	}
}
