import http from "http";
import https from "https";

export class MaximAPI {
	private baseUrl: string;
	private apiKey: string;
	// Create agents with keepAlive: false to ensure connections are closed
	private httpAgent = new http.Agent({ keepAlive: false });
	private httpsAgent = new https.Agent({ keepAlive: false });

	constructor(baseUrl: string, apiKey: string) {
		this.baseUrl = baseUrl;
		this.apiKey = apiKey;
	}

	protected fetch<T>(
		relativeUrl: string,
		{
			method,
			headers,
			body,
		}: {
			method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
			headers?: { [key: string]: string };
			body?: string;
		} = {},
	): Promise<T> {
		return new Promise((resolve, reject) => {
			const parsedUrl = new URL(this.baseUrl + relativeUrl);
			const isLocalhost = parsedUrl.hostname === "localhost";

			const requestHeaders: { [key: string]: string } = {
				"x-maxim-api-key": this.apiKey,
				...headers,
			};

			if (body) {
				requestHeaders["Content-Length"] = Buffer.byteLength(body, "utf8").toString();
			}

			const options = {
				hostname: parsedUrl.hostname,
				port: isLocalhost ? parsedUrl.port || 3000 : 443,
				path: parsedUrl.pathname + parsedUrl.search,
				method: method ?? "GET",
				headers: requestHeaders,
				// Use appropriate agent to ensure connections are closed
				agent: isLocalhost ? this.httpAgent : this.httpsAgent,
				// Set a timeout to ensure requests don't hang indefinitely
				// timeout: 10000,
			};
			const requestModule = isLocalhost ? http : https;
			const makeRequest = (retryCount = 0) => {
				const req = requestModule.request(options, (res) => {
					let data = "";
					res.on("data", (chunk) => {
						data += chunk;
					});
					res.on("end", () => {
						try {
							const response = JSON.parse(data);
							resolve(response);
						} catch (error) {
							if (retryCount < 3) {
								setTimeout(() => makeRequest(retryCount + 1), 30);
							} else {
								reject(error);
							}
						}
					});
				});

				// Add timeout handling
				req.on("timeout", () => {
					req.destroy();
					if (retryCount < 3) {
						setTimeout(() => makeRequest(retryCount + 1), 30);
					} else {
						reject(new Error("Request timed out"));
					}
				});

				req.on("error", (error) => {
					console.error("Error while connecting to Maxim Server", error);
					// Make sure to destroy the request to clean up resources
					req.destroy();
					if (retryCount < 3) {
						setTimeout(() => makeRequest(retryCount + 1), 30);
					} else {
						reject(error);
					}
				});
				if (body) {
					req.write(body);
				}
				req.end();
			};
			makeRequest();
		});
	}

	/**
	 * Destroys the HTTP and HTTPS agents, closing all sockets
	 */
	public destroyAgents(): void {
		this.httpAgent.destroy();
		this.httpsAgent.destroy();
	}
}
