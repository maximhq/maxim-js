import type { Variable } from "../models/dataset";
import { VariableType } from "../models/dataset";
import { MaximAPIResponse } from "../models/deployment";
import { HumanEvaluationConfig, MaximAPIEvaluatorFetchResponse } from "../models/evaluator";
import {
	MaximAPICreateTestRunResponse,
	MaximAPITestRunEntryCreatePayload,
	MaximAPITestRunEntryCreateResponse,
	MaximAPITestRunEntryExecutePromptChainForDataPayload,
	MaximAPITestRunEntryExecutePromptChainForDataResponse,
	MaximAPITestRunEntryExecutePromptForDataPayload,
	MaximAPITestRunEntryExecutePromptForDataResponse,
	MaximAPITestRunEntryExecuteSimulationPromptGetResponse,
	MaximAPITestRunEntryExecuteSimulationPromptPayload,
	MaximAPITestRunEntryExecuteSimulationPromptPostResponse,
	MaximAPITestRunEntryExecuteSimulationWorkflowGetResponse,
	MaximAPITestRunEntryExecuteSimulationWorkflowPayload,
	MaximAPITestRunEntryExecuteSimulationWorkflowPostResponse,
	MaximAPITestRunEntryExecuteWorkflowForDataPayload,
	MaximAPITestRunEntryExecuteWorkflowForDataResponse,
	MaximAPITestRunEntryPushPayload,
	MaximAPITestRunResultResponse,
	MaximAPITestRunSimulationLocalExecutionPayload,
	MaximAPITestRunSimulationLocalExecutionPostResponse,
	MaximAPITestRunSimulationLocalExecutionRawResponse,
	MaximAPITestRunStatusResponse,
	TestRunConfig,
	TestRunResult,
} from "../models/testRun";
import { MaximAPISignedURLResponse } from "../models/attachment";
import type { Attachment, FileAttachment, FileDataAttachment, UrlAttachment } from "../types";
import { platform } from "../platform";
import { ExtractAPIDataType } from "../utils/utils";
import { MaximAPI } from "./maxim";

export class MaximTestRunAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string, isDebug?: boolean) {
		super(baseUrl, apiKey, isDebug);
	}

	public async createTestRun(
		name: string,
		workspaceId: string,
		runType: "SINGLE" | "COMPARISON",
		evaluatorConfig: ExtractAPIDataType<MaximAPIEvaluatorFetchResponse>[],
		requiresLocalRun: boolean,
		workflowId?: string,
		promptVersionId?: string,
		promptChainVersionId?: string,
		humanEvaluationConfig?: HumanEvaluationConfig,
		tags?: string[],
		simulationConfig?: TestRunConfig["simulationConfig"],
		connectedRepoId?: string,
	): Promise<ExtractAPIDataType<MaximAPICreateTestRunResponse>> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPICreateTestRunResponse>(`/api/sdk/v2/test-run/create`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					name,
					workspaceId,
					runType,
					evaluatorConfig,
					requiresLocalRun,
					workflowId,
					promptVersionId,
					promptChainVersionId,
					humanEvaluationConfig,
					tags,
					simulationConfig,
					connectedRepoId,
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

	public async markTestRunFailed(testRunId: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.fetch<MaximAPIResponse>(`/api/sdk/v1/test-run/mark-failed`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					testRunId,
				}),
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

	public async updateSimulationStatus(testRunEntryId: string, status: "FAILED"): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.fetch<MaximAPIResponse>(`/api/sdk/v2/test-run/simulation/update-status`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					testRunEntryId,
					status,
				}),
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

	public async attachDatasetToTestRun(testRunId: string, datasetId: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIResponse>(`/api/sdk/v1/test-run/attach-dataset`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					testRunId,
					datasetId,
				}),
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

	/**
	 * Checks if a value is already in Variable format.
	 */
	private isVariable(value: unknown): value is Variable {
		return (
			typeof value === "object" &&
			value !== null &&
			"type" in value &&
			"payload" in value &&
			(Object.values(VariableType) as string[]).includes(value.type as string)
		);
	}

	/**
	 * Converts dataEntry values from string/string[] to Variable type format.
	 * - string -> { type: "text", payload: string }
	 * - string[] -> { type: "file", payload: UrlAttachment[] }
	 * - null/undefined -> undefined (skipped)
	 */
	private convertDataEntryToVariables(
		dataEntry: Record<string, string | string[] | null | undefined>,
	): Record<string, Variable | undefined> {
		const result: Record<string, Variable | undefined> = {};

		for (const [key, value] of Object.entries(dataEntry)) {
			if (value === null || value === undefined) {
				// Skip null/undefined values
				continue;
			}

			if (Array.isArray(value)) {
				// Convert string array to FILE Variable with UrlAttachment[]
				const attachments: UrlAttachment[] = value.map((url, index) => ({
					type: "url" as const,
					id: `${key}-${index}`,
					url: url,
				}));
				result[key] = {
					type: VariableType.FILE,
					payload: attachments,
				};
			} else {
				// Convert string to TEXT Variable
				result[key] = {
					type: VariableType.TEXT,
					payload: value,
				};
			}
		}

		return result;
	}

	/**
	 * Normalizes raw dataEntry to Variable format. If any value is a plain string/array,
	 * converts via convertDataEntryToVariables; otherwise returns the entry as-is (already Variable).
	 */
	private normalizeDataEntryToVariables(
		rawDataEntry: Record<string, string | string[] | Variable | null | undefined>,
	): Record<string, Variable | undefined> {
		const needsConversion = Object.values(rawDataEntry).some(
			(value) => value !== null && value !== undefined && !this.isVariable(value),
		);
		return needsConversion
			? this.convertDataEntryToVariables(rawDataEntry as Record<string, string | string[] | null | undefined>)
			: (rawDataEntry as Record<string, Variable | undefined>);
	}

	/**
	 * Signed upload URL for log-repository attachments (same service as {@link MaximAttachmentAPI}).
	 */
	private async getLogAttachmentUploadUrl(
		key: string,
		mimeType: string,
		size: number,
	): Promise<Extract<MaximAPISignedURLResponse, { data: unknown }>["data"]> {
		const response = await this.fetch<MaximAPISignedURLResponse>(
			`/api/sdk/v1/log-repositories/attachments/upload-url?key=${encodeURIComponent(key)}&mimeType=${encodeURIComponent(mimeType)}&size=${size}`,
		);
		if ("error" in response) {
			throw response.error;
		}
		return response.data;
	}

	private async uploadBufferToSignedUrl(url: string, data: Buffer, mimeType: string): Promise<void> {
		const response = await this.axiosInstance.put(url, data, {
			headers: {
				"Content-Type": mimeType,
				"Content-Length": data.length.toString(),
			},
			responseType: "text",
			timeout: 120000,
			transformRequest: [(body: Buffer) => body],
			transformResponse: [(body: unknown) => body],
			baseURL: "",
		});
		if (response.status >= 200 && response.status < 300) {
			return;
		}
		if (response.data && typeof response.data === "object" && "error" in response.data) {
			throw (response.data as { error: unknown }).error;
		}
		throw response.data;
	}

	private async readFileOrFileDataAttachment(
		attachment: FileAttachment | FileDataAttachment,
	): Promise<{ fileData: Buffer; mimeType: string; size: number }> {
		const maxFileSizeBytes = 1024 * 1024 * 100;
		if (attachment.type === "fileData") {
			const fileData = attachment.data;
			const mimeType = attachment.mimeType || "application/octet-stream";
			const size = fileData.length;
			if (size > maxFileSizeBytes) {
				throw new Error(`File size exceeds the maximum allowed size of ${maxFileSizeBytes} bytes`);
			}
			return { fileData, mimeType, size };
		}
		if (!platform.features.fileIoSupported) {
			throw new Error("File operations are not supported in this environment");
		}
		let stats;
		try {
			stats = await platform.fs.readFile(attachment.path);
		} catch {
			throw new Error(`File not found: ${attachment.path}`);
		}
		if (stats.data.length > maxFileSizeBytes) {
			throw new Error(`File size exceeds the maximum allowed size of ${maxFileSizeBytes} bytes`);
		}
		let fileData: Buffer;
		try {
			fileData = Buffer.from(stats.data);
		} catch {
			throw new Error(`File not found: ${attachment.path}`);
		}
		let mimeType = attachment.mimeType || "application/octet-stream";
		if (!mimeType || mimeType === "application/octet-stream") {
			const source = attachment.name ?? attachment.path;
			const inferred = platform.mime.lookup(source);
			if (inferred) {
				mimeType = inferred;
			}
		}
		return { fileData, mimeType, size: fileData.length };
	}

	/**
	 * Resolves a remotely fetchable URL for push payloads: URL attachments pass through;
	 * local file / in-memory fileData attachments are uploaded via the log attachment pipeline.
	 */
	private async resolveAttachmentUrlForPush(attachment: Attachment, testRunId: string): Promise<string> {
		if (attachment.type === "url") {
			const u = (attachment as UrlAttachment).url;
			if (!u || (!u.startsWith("http://") && !u.startsWith("https://"))) {
				throw new Error(`Invalid URL: ${u}`);
			}
			return u;
		}
		const { fileData, mimeType, size } = await this.readFileOrFileDataAttachment(attachment);
		const key = `test-run/${testRunId}/${attachment.id}`;
		const { url } = await this.getLogAttachmentUploadUrl(key, mimeType, size);
		try {
			await this.uploadBufferToSignedUrl(url, fileData, mimeType);
		} catch (error) {
			const name = attachment.name ?? attachment.id;
			throw new Error(`Failed to upload attachment ${name}: ${error instanceof Error ? error.message : String(error)}`);
		}
		return url;
	}

	/**
	 * Converts Variable format to API format for dataEntry (TEXT / JSON only).
	 */
	private convertNonFileVariableToAPIFormat(
		variable: Variable,
	): { type: "text"; payload: string } {
		if (variable.type === VariableType.TEXT || variable.type === VariableType.JSON) {
			return {
				type: "text",
				payload: variable.payload,
			};
		}
		return {
			type: "text",
			payload: "",
		};
	}

	/**
	 * Converts a FILE variable to API format, uploading local/fileData attachments first.
	 */
	private async convertFileVariableToAPIFormat(
		variable: Extract<Variable, { type: VariableType.FILE }>,
		testRunId: string,
	): Promise<{ type: "file"; payload: { files: Array<{ id?: string; url: string; name?: string; type: string }>; text?: string } }> {
		const files = await Promise.all(
			variable.payload.map(async (attachment) => {
				const url = await this.resolveAttachmentUrlForPush(attachment, testRunId);
				return {
					id: attachment.id,
					url,
					name: attachment.name,
					type: attachment.mimeType || "application/octet-stream",
				};
			}),
		);
		return {
			type: "file",
			payload: { files },
		};
	}

	/**
	 * Converts dataEntry from Variable format to API format.
	 * FILE variables upload non-URL attachments before building the payload.
	 */
	private async convertDataEntryToAPIFormat(
		dataEntry: Record<string, string | string[] | Variable | null | undefined>,
		testRunId: string,
	): Promise<
		Record<
			string,
			| { type: "text"; payload: string }
			| { type: "file"; payload: { files: Array<{ id?: string; url: string; name?: string; type: string }>; text?: string } }
			| null
			| undefined
		>
	> {
		const result: Record<
			string,
			| { type: "text"; payload: string }
			| { type: "file"; payload: { files: Array<{ id?: string; url: string; name?: string; type: string }>; text?: string } }
			| null
			| undefined
		> = {};

		for (const [key, value] of Object.entries(dataEntry)) {
			if (value === null || value === undefined) {
				result[key] = value;
				continue;
			}

			if (this.isVariable(value)) {
				if (value.type === VariableType.FILE) {
					result[key] = await this.convertFileVariableToAPIFormat(value, testRunId);
				} else {
					result[key] = this.convertNonFileVariableToAPIFormat(value);
				}
			} else if (typeof value === "string") {
				result[key] = {
					type: "text",
					payload: value,
				};
			} else if (Array.isArray(value)) {
				const files = value.map((url, index) => ({
					id: `${key}-${index}`,
					url: url,
					type: "application/octet-stream",
				}));
				result[key] = {
					type: "file",
					payload: {
						files,
					},
				};
			}
		}

		return result;
	}

	public async createTestRunEntry({
		testRun,
	}: MaximAPITestRunEntryCreatePayload): Promise<ExtractAPIDataType<MaximAPITestRunEntryCreateResponse>> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunEntryCreateResponse>(`/api/sdk/v1/test-run/test-run-entry/create`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					testRun,
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

	public async pushTestRunEntry({ testRun, runConfig, entry, localSimulation }: MaximAPITestRunEntryPushPayload): Promise<void> {
		const convertedEntry = entry.dataEntry
			? {
					...entry,
					dataEntry: await this.convertDataEntryToAPIFormat(entry.dataEntry, testRun.id),
				}
			: entry;

		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIResponse>(`/api/sdk/v4/test-run/push`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					testRun,
					runConfig,
					entry: convertedEntry,
					...(localSimulation !== undefined && { localSimulation }),
				}),
			})
				.then((response) => {
					if ("error" in response) {
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

	public async markTestRunProcessed(testRunId: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.fetch<MaximAPIResponse>(`/api/sdk/v1/test-run/mark-processed`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					testRunId,
				}),
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

	public async getTestRunStatus(testRunId: string): Promise<{
		entryStatus: {
			total: number;
			running: number;
			completed: number;
			failed: number;
			queued: number;
			stopped: number;
		};
		testRunStatus: "QUEUED" | "RUNNING" | "FAILED" | "COMPLETE" | "STOPPED";
	}> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunStatusResponse>(`/api/sdk/v1/test-run/status?testRunId=${testRunId}`)
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

	public async getTestRunFinalResult(testRunId: string): Promise<TestRunResult> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunResultResponse>(`/api/sdk/v1/test-run/result?testRunId=${testRunId}`)
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

	public async executeWorkflowForData({
		dataEntry,
		workflowId,
		contextToEvaluate,
	}: MaximAPITestRunEntryExecuteWorkflowForDataPayload): Promise<ExtractAPIDataType<MaximAPITestRunEntryExecuteWorkflowForDataResponse>> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunEntryExecuteWorkflowForDataResponse>(`/api/sdk/v1/test-run/execute/workflow`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					workflowId,
					dataEntry,
					contextToEvaluate,
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

	public async executePromptForData({
		promptVersionId,
		input,
		dataEntry,
		contextToEvaluate,
		simulationConfig,
	}: MaximAPITestRunEntryExecutePromptForDataPayload): Promise<ExtractAPIDataType<MaximAPITestRunEntryExecutePromptForDataResponse>> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunEntryExecutePromptForDataResponse>(`/api/sdk/v1/test-run/execute/prompt`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					promptVersionId,
					input,
					dataEntry,
					contextToEvaluate,
					simulationConfig
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

	public async executePromptChainForData({
		promptChainVersionId,
		input,
		dataEntry,
		contextToEvaluate,
	}: MaximAPITestRunEntryExecutePromptChainForDataPayload): Promise<
		ExtractAPIDataType<MaximAPITestRunEntryExecutePromptChainForDataResponse>
	> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunEntryExecutePromptChainForDataResponse>(`/api/sdk/v1/test-run/execute/prompt-chain`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					promptChainVersionId,
					input,
					dataEntry,
					contextToEvaluate,
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

	public async executeSimulationPromptForData({
		testRunId,
		promptVersionId,
		workspaceId,
		datasetEntryId,
		entry,
		simulationConfig,
	}: MaximAPITestRunEntryExecuteSimulationPromptPayload): Promise<
		ExtractAPIDataType<MaximAPITestRunEntryExecuteSimulationPromptPostResponse>
	> {
		const convertedEntry =
			entry?.dataEntry != null
				? {
						...entry,
						dataEntry: this.normalizeDataEntryToVariables(
							entry.dataEntry as Record<string, string | string[] | Variable | null | undefined>,
						),
					}
				: entry;

		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunEntryExecuteSimulationPromptPostResponse>(`/api/sdk/v2/test-run/execute/simulation/prompt`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					testRunId,
					promptVersionId,
					workspaceId,
					datasetEntryId,
					entry: convertedEntry,
					simulationConfig,
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

	public async getSimulationPromptStatus({
		workspaceId,
		testRunEntryId,
	}: {
		workspaceId: string;
		testRunEntryId: string;
	}): Promise<ExtractAPIDataType<MaximAPITestRunEntryExecuteSimulationPromptGetResponse>> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunEntryExecuteSimulationPromptGetResponse>(
				`/api/sdk/v2/test-run/execute/simulation/prompt?workspaceId=${workspaceId}&testRunEntryId=${testRunEntryId}`,
				{
					method: "GET",
					headers: {
						Accept: "application/json",
					},
				},
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
	
	public async executeSimulationWorkflowForData({
		testRunId,
		workflowId,
		workspaceId,
		datasetEntryId,
		entry,
		simulationConfig,
	}: MaximAPITestRunEntryExecuteSimulationWorkflowPayload): Promise<
		ExtractAPIDataType<MaximAPITestRunEntryExecuteSimulationWorkflowPostResponse>
	> {
		const convertedEntry =
			entry?.dataEntry != null
				? {
						...entry,
						dataEntry: this.normalizeDataEntryToVariables(
							entry.dataEntry as Record<string, string | string[] | Variable | null | undefined>,
						),
					}
				: entry;

		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunEntryExecuteSimulationWorkflowPostResponse>(`/api/sdk/v2/test-run/execute/simulation/workflow`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					testRunId,
					workflowId,
					workspaceId,
					datasetEntryId,
					entry: convertedEntry,
					simulationConfig,
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

	public async getSimulationWorkflowStatus({
		workspaceId,
		testRunEntryId,
	}: {
		workspaceId: string;
		testRunEntryId: string;
	}): Promise<ExtractAPIDataType<MaximAPITestRunEntryExecuteSimulationWorkflowGetResponse>> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunEntryExecuteSimulationWorkflowGetResponse>(
				`/api/sdk/v2/test-run/execute/simulation/workflow?workspaceId=${workspaceId}&testRunEntryId=${testRunEntryId}`,
				{
					method: "GET",
					headers: {
						Accept: "application/json",
					},
				},
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

	public async executeSimulationLocalExecution({
		testRunId,
		workspaceId,
		datasetEntryId,
		entry,
		simulationConfig,
		conversationHistory,
		testRunEntryId,
	}: MaximAPITestRunSimulationLocalExecutionPayload): Promise<
		ExtractAPIDataType<MaximAPITestRunSimulationLocalExecutionPostResponse>
	> {
		const convertedEntry =
			entry?.dataEntry != null
				? {
						...entry,
						dataEntry: this.normalizeDataEntryToVariables(
							entry.dataEntry as Record<string, string | string[] | Variable | null | undefined>,
						),
					}
				: entry;

		const serializedSimulationConfig = this.serializeSimulationConfig(simulationConfig);

		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunSimulationLocalExecutionRawResponse>(
				`/api/sdk/v2/test-run/simulation/local-execution`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
					},
					body: JSON.stringify({
						testRunId,
						workspaceId,
						datasetEntryId,
						entry: convertedEntry,
						simulationConfig: serializedSimulationConfig,
						conversationHistory,
						testRunEntryId,
					}),
				},
			)
				.then((response) => {
					if ("error" in response) {
						reject(response.error);
					} else {
						// Normalize userInput: backend returns string|null,
						// convert to {input: string} for consumer convenience
						const normalizedData = {
							...response.data,
							userInput: this.normalizeUserInput(response.data.userInput),
						};
						resolve(normalizedData);
					}
				})
				.catch((error) => {
					reject(error);
				});
		});
	}

	/**
	 * Normalize userInput from backend (string|null) to Record<string, unknown>|null.
	 * Backend returns plain string; SDK consumers expect {input: string}.
	 */
	private normalizeUserInput(userInput: string | null): Record<string, unknown> | null {
		if (userInput === null || userInput === undefined) return null;
		if (typeof userInput === "string") return { input: userInput };
		if (typeof userInput === "object") return userInput as Record<string, unknown>;
		return { input: String(userInput) };
	}

	/**
	 * Serialize simulationConfig for the backend API.
	 * Flattens customSimulator fields to top level (matching backend's flat schema).
	 */
	private serializeSimulationConfig(
		config: TestRunConfig["simulationConfig"],
	): Record<string, unknown> | undefined {
		if (!config) return undefined;
		const result: Record<string, unknown> = { ...config };

		if (config.customSimulator) {
			result["type"] = "CUSTOM";
			result["simulatorPrompt"] = config.customSimulator.simulatorPrompt;
			if (config.customSimulator.model) result["model"] = config.customSimulator.model;
			if (config.customSimulator.provider) result["provider"] = config.customSimulator.provider;
			if (config.customSimulator.variables) result["variables"] = config.customSimulator.variables;
			if (config.customSimulator.variableBindings) result["variableBindings"] = config.customSimulator.variableBindings;
			if (config.customSimulator.modelParameters) result["modelParameters"] = config.customSimulator.modelParameters;
			delete result["customSimulator"];
		}

		return result;
	}
}
