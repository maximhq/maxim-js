import { MaximAPISignedURLResponse } from "../models/attachment";
import { MaximAPI } from "./maxim";

export class MaximAttachmentAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string) {
		super(baseUrl, apiKey);
	}

	public async getUploadUrl(
		key: string,
		mimeType: string,
		size: number,
	): Promise<Extract<MaximAPISignedURLResponse, { data: unknown }>["data"]> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPISignedURLResponse>(
				`/api/sdk/v1/log-repositories/attachments/upload-url?key=${key}&mimeType=${mimeType}&size=${size}`,
			)
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

	public async uploadToSignedUrl(url: string, data: Buffer, mimeType: string): Promise<void> {
		// This is a direct upload to a signed URL, not a multipart upload
		return new Promise((resolve, reject) => {
			const parsedUrl = new URL(url);
			const isLocalhost = parsedUrl.hostname === "localhost";
			const requestModule = isLocalhost ? require("http") : require("https");

			const makeRequest = (retryCount = 0) => {
				const options = {
					hostname: parsedUrl.hostname,
					port: isLocalhost ? parsedUrl.port || 3000 : 443,
					path: parsedUrl.pathname + parsedUrl.search,
					method: "PUT",
					headers: {
						"Content-Type": mimeType,
						"Content-Length": data.length,
					},
				};
				const req = requestModule.request(options, (res: any) => {
					if (res.statusCode >= 200 && res.statusCode < 300) {
						resolve();
					} else {
						if (retryCount < 3) {
							console.warn(`[MaximSDK] Upload failed with status ${res.statusCode}, retrying (${retryCount + 1}/3)...`);
							makeRequest(retryCount + 1);
						} else {
							reject(new Error(`Failed to upload file: HTTP status ${res.statusCode} after 3 retries`));
						}
					}
				});
				req.on("error", (error: any) => {
					if (retryCount < 3) {
						console.warn(`[MaximSDK] Upload failed with error: ${error.message}, retrying (${retryCount + 1}/3)...`);
						makeRequest(retryCount + 1);
					} else {
						reject(error);
					}
				});

				req.write(data);
				req.end();
			};
			makeRequest();
		});
	}
}
