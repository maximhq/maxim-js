import axios, { AxiosError, AxiosHeaders, AxiosInstance, AxiosRequestConfig, Method } from "axios";
import axiosRetry from "axios-retry";
import { platform } from "../platform";

// Network error codes that should trigger retries
const RETRIABLE_ERROR_CODES = [
	"ECONNRESET",
	"ENOTFOUND",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"ECONNABORTED",
	"EPIPE",
	"EAI_AGAIN",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENETDOWN",
	"EHOSTDOWN",
];

// HTTP status codes that indicate temporary server issues
const RETRIABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504, 507, 508, 510, 511, 520, 521, 522, 523, 524, 525, 526, 527, 529, 530];

export class MaximAPI {
	private apiKey: string;
	protected axiosInstance: AxiosInstance;
	protected isDebug: boolean | undefined;
	private activeControllers: Set<AbortController> = new Set();

	constructor(baseUrl: string, apiKey: string, isDebug?: boolean) {
		this.apiKey = apiKey;
		this.isDebug = isDebug;

		// Create axios instance with optimal configuration
		const axiosConfig: AxiosRequestConfig = {
			baseURL: baseUrl,
			timeout: 30000, // 30 second timeout
			headers: {
				"User-Agent": "Maxim-SDK/1.0",
				Accept: "application/json",
				Connection: "keep-alive",
			},
			// Handle both localhost and production environments
			validateStatus: (status) => status < 600, // Don't throw on any status code, let us handle it
		};

		// Add agents only if platform supports them
		const httpAgent = platform.net.httpAgent({
			keepAlive: true,
			keepAliveMsecs: 30000,
			maxSockets: 100,
			maxFreeSockets: 10,
			timeout: 30000,
		});
		const httpsAgent = platform.net.httpsAgent({
			keepAlive: true,
			keepAliveMsecs: 30000,
			maxSockets: 100,
			maxFreeSockets: 10,
			timeout: 30000,
		});

		if (httpAgent) axiosConfig.httpAgent = httpAgent;
		if (httpsAgent) axiosConfig.httpsAgent = httpsAgent;

		this.axiosInstance = axios.create(axiosConfig);

		// Configure comprehensive retry logic
		axiosRetry(this.axiosInstance, {
			retries: 5, // Maximum retry attempts

			// Exponential backoff with jitter to prevent thundering herd
			retryDelay: (retryCount, error) => {
				// Respect Retry-After header if present
				const retryAfter = error.response?.headers["retry-after"];
				if (retryAfter && !isNaN(Number.parseInt(retryAfter))) {
					return Number.parseInt(retryAfter) * 1000;
				}

				// Exponential backoff: 1s, 2s, 4s, 8s, 16s with jitter
				const delay = Math.min(Math.pow(2, retryCount) * 1000, 16000);
				const jitter = Math.random() * 0.1 * delay; // 10% jitter
				return delay + jitter;
			},

			// Enhanced retry conditions
			retryCondition: (error: AxiosError) => {
				// Network errors (ECONNRESET, EPIPE, etc.)
				if (error.code && RETRIABLE_ERROR_CODES.includes(error.code)) {
					return true;
				}

				// Timeout errors
				if (error.code === "ECONNABORTED" && error.message?.includes("timeout")) {
					return true;
				}

				// No response received (network issues)
				if (!error.response) {
					return true;
				}

				// Server errors and rate limiting
				if (error.response.status && RETRIABLE_STATUS_CODES.includes(error.response.status)) {
					return true;
				}

				// Client errors should not be retried
				return false;
			},

			// Reset timeout on each retry attempt
			shouldResetTimeout: true,

			// Retry callback for logging
			onRetry: (retryCount, error, requestConfig) => {
				const errorInfo = {
					attempt: retryCount,
					error: error.code || error.message,
					status: error.response?.status,
					url: requestConfig.url,
				};
				if (this.isDebug) {
					console.warn(`[Maxim-SDK] Retrying request (attempt ${retryCount}/5):`, errorInfo);
				}
			},

			// Max retry time exceeded callback
			onMaxRetryTimesExceeded: (error, retryCount) => {
				console.error(`[Maxim-SDK] Max retries (${retryCount}) exceeded for request:`, {
					error: error.code || error.message,
					status: error.response?.status,
					url: error.config?.url,
				});
			},
		});

		// Request interceptor to add API key and handle special cases
		this.axiosInstance.interceptors.request.use(
			(config) => {
				// Ensure headers object exists
				if (!config.headers) {
					config.headers = new AxiosHeaders();
				}

				// Add API key header
				config.headers["x-maxim-api-key"] = this.apiKey;

				return config;
			},
			(error) => {
				return Promise.reject(error);
			},
		);

		// Response interceptor for enhanced error handling
		this.axiosInstance.interceptors.response.use(
			(response) => {
				return response;
			},
			(error: unknown) => {
				if (error && typeof error === "object" && "error" in error) {
					return Promise.reject(error.error);
				}
				return Promise.reject(error);
			},
		);
	}

	protected async fetch<T>(
		relativeUrl: string,
		{
			method = "GET",
			headers = {},
			body,
			responseType = "json",
		}: {
			method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
			headers?: { [key: string]: string };
			body?: string;
			responseType?: "json" | "text";
		} = {},
	): Promise<T> {
		const controller = new AbortController();
		this.activeControllers.add(controller);
		const config: AxiosRequestConfig = {
			url: relativeUrl,
			method: method.toLowerCase() as Method,
			headers: { ...headers },
			responseType: responseType,
			signal: controller.signal,
		};

		// Add request body if provided
		if (body) {
			config.data = body;
			// Ensure headers object exists and get reference
			const configHeaders = config.headers ?? new AxiosHeaders();
			config.headers = configHeaders;

			// Set content-type if not already set
			if (!configHeaders["Content-Type"] && !configHeaders["content-type"]) {
				configHeaders["Content-Type"] = "application/json";
			}
		}

		try {
			const response = await this.axiosInstance.request<T>(config);
			// For successful responses, return the data
			if (response.status >= 200 && response.status < 300) {
				return response.data;
			}
			// For non-2xx responses that didn't trigger axios errors
			if (response.data && typeof response.data === "object" && "error" in response.data) {
				const { error } = response.data;
				if (typeof error === "string") {
					throw error;
				}
				if (error && typeof error === "object" && "message" in error) {
					throw error.message;
				}
				throw JSON.stringify(error, null, 2);
			}
			throw response.data;
		} finally {
			this.activeControllers.delete(controller);
		}
	}

	/**
	 * Destroys the HTTP and HTTPS agents, closing all sockets
	 */
	public destroyAgents(): void {
		// Axios doesn't expose agents directly, but we can ensure all pending requests are cancelled
		// and connection pools are cleaned up
		if (this.axiosInstance) {
			// Abort all active requests
			for (const controller of this.activeControllers) {
				controller.abort();
			}
			this.activeControllers.clear();

			// Clear interceptors
			this.axiosInstance.interceptors.request.clear();
			this.axiosInstance.interceptors.response.clear();
		}
	}
}
