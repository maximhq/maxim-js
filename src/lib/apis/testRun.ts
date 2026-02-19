import type { Variable } from "../models/dataset";
import { VariableType } from "../models/dataset";
import { MaximAPIResponse } from "../models/deployment";
import { HumanEvaluationConfig, MaximAPIEvaluatorFetchResponse } from "../models/evaluator";
import {
	MaximAPICreateTestRunResponse,
	MaximAPITestRunEntryExecutePromptChainForDataPayload,
	MaximAPITestRunEntryExecutePromptChainForDataResponse,
	MaximAPITestRunEntryExecutePromptForDataPayload,
	MaximAPITestRunEntryExecutePromptForDataResponse,
	MaximAPITestRunEntryExecuteSimulationPromptPayload,
	MaximAPITestRunEntryExecuteSimulationPromptPostResponse,
	MaximAPITestRunEntryExecuteSimulationPromptGetResponse,
	MaximAPITestRunEntryExecuteSimulationWorkflowPayload,
	MaximAPITestRunEntryExecuteSimulationWorkflowPostResponse,
	MaximAPITestRunEntryExecuteSimulationWorkflowGetResponse,
	MaximAPITestRunEntryExecuteWorkflowForDataPayload,
	MaximAPITestRunEntryExecuteWorkflowForDataResponse,
	MaximAPITestRunEntryPushPayload,
	MaximAPITestRunResultResponse,
	MaximAPITestRunStatusResponse,
	MaximAPITestRunSimulationLocalExecutionPayload,
	MaximAPITestRunSimulationLocalExecutionPostResponse,
	TestRunConfig,
	TestRunResult,
} from "../models/testRun";
import type { UrlAttachment } from "../types";
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

	public async pushTestRunEntry({ testRun, runConfig, entry, localSimulation }: MaximAPITestRunEntryPushPayload): Promise<void> {
		const convertedEntry = entry.dataEntry
			? {
					...entry,
					dataEntry: this.normalizeDataEntryToVariables(entry.dataEntry),
				}
			: entry;

		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIResponse>(`/api/sdk/v2/test-run/push`, {
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

	public async executeSimulationLocalPromptExecution({
		testRunId,
		workspaceId,
		promptVersionId,
		datasetEntryId,
		entry,
		simulationConfig,
		conversationHistory,
		testRunEntryId,
	}: MaximAPITestRunSimulationLocalExecutionPayload): Promise<
		ExtractAPIDataType<MaximAPITestRunSimulationLocalExecutionPostResponse>
	> {
		const resolvedPersona = simulationConfig?.persona
			? typeof simulationConfig.persona === "string"
				? simulationConfig.persona
				: String(
						(entry?.dataEntry as Record<string, unknown>)?.[simulationConfig.persona.payload] ?? "",
					)
			: undefined;

		const convertedEntry =
			entry?.dataEntry != null
				? {
						...entry,
						dataEntry: this.normalizeDataEntryToVariables(
							entry.dataEntry as Record<string, string | string[] | Variable | null | undefined>,
						),
						...(resolvedPersona !== undefined && { persona: resolvedPersona }),
					}
				: entry
					? { ...entry, ...(resolvedPersona !== undefined && { persona: resolvedPersona }) }
					: entry;

		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunSimulationLocalExecutionPostResponse>(
				`/api/sdk/v2/test-run/simulation/prompt/local-execution`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
					},
					body: JSON.stringify({
						testRunId,
						workspaceId,
						promptVersionId,
						datasetEntryId,
						entry: convertedEntry,
						simulationConfig,
						conversationHistory,
						testRunEntryId,
					}),
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

	public async executeSimulationLocalWorkflowExecution({
		testRunId,
		workspaceId,
		workflowId,
		datasetEntryId,
		entry,
		simulationConfig,
		conversationHistory,
		testRunEntryId,
	}: MaximAPITestRunSimulationLocalExecutionPayload): Promise<
		ExtractAPIDataType<MaximAPITestRunSimulationLocalExecutionPostResponse>
	> {
		const resolvedPersona = simulationConfig?.persona
			? typeof simulationConfig.persona === "string"
				? simulationConfig.persona
				: String(
						(entry?.dataEntry as Record<string, unknown>)?.[simulationConfig.persona.payload] ?? "",
					)
			: undefined;

		const convertedEntry =
			entry?.dataEntry != null
				? {
						...entry,
						dataEntry: this.normalizeDataEntryToVariables(
							entry.dataEntry as Record<string, string | string[] | Variable | null | undefined>,
						),
						...(resolvedPersona !== undefined && { persona: resolvedPersona }),
					}
				: entry
					? { ...entry, ...(resolvedPersona !== undefined && { persona: resolvedPersona }) }
					: entry;

		return new Promise((resolve, reject) => {
			this.fetch<MaximAPITestRunSimulationLocalExecutionPostResponse>(
				`/api/sdk/v2/test-run/simulation/workflow/local-execution`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
					},
					body: JSON.stringify({
						testRunId,
						workspaceId,
						workflowId,
						datasetEntryId,
						entry: convertedEntry,
						simulationConfig,
						conversationHistory,
						testRunEntryId,
					}),
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
}
