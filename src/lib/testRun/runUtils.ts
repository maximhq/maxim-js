import { MaximTestRunAPI } from "../apis/testRun";
import type { Data, DataStructure } from "../models/dataset";
import type {
	CombinedLocalEvaluatorType,
	LocalEvaluationResult,
	LocalEvaluatorType,
	PassFailCriteriaType,
	Result,
} from "../models/evaluator";
import type { TestRunConfig, TestRunLogger, YieldedOutput } from "../models/testRun";
import { ExtractAPIDataType } from "../utils/utils";
import type { MaximAPITestRunEntryExecuteSimulationPromptGetResponse } from "../models/testRun";
import type { MaximAPITestRunEntryExecuteSimulationWorkflowGetResponse } from "../models/testRun";

export async function runOutputFunction<T extends DataStructure | undefined>(
	outputFunction: NonNullable<TestRunConfig<T>["outputFunction"]>,
	dataEntry: Data<T>,
): Promise<ReturnType<NonNullable<TestRunConfig<T>["outputFunction"]>>> {
	try {
		const result = await outputFunction(dataEntry);
		return result;
	} catch (err) {
		throw new Error(`Error while running output function`, {
			cause: err,
		});
	}
}

/**
 * Runs local evaluations on the data entry.
 * @param evaluators - The evaluators to run
 * @param dataEntry - The data entry to evaluate
 * @param output - The output of the run
 * @param contextToEvaluate - The context to evaluate
 * @returns The results of the evaluations
 */
export async function runLocalEvaluations<T extends DataStructure | undefined>(
	evaluators: (LocalEvaluatorType<T> | CombinedLocalEvaluatorType<T, Record<string, PassFailCriteriaType>>)[],
	dataEntry: Data<T>,
	output: YieldedOutput & Record<string, string>,
	contextToEvaluate?: string | string[],
): Promise<LocalEvaluationResult[]> {
	try {
		const evaluatorResults = await Promise.all(
			evaluators.map(async (evaluator): Promise<LocalEvaluationResult[]> => {
				// Build the result object with fixed properties
				const evaluationResultArgs: Result = { 
					output: output.data, 
					contextToEvaluate,
					simulationOutputs: output.simulationOutputs,
				};


				// Build the variables object separately from variableMapping
				const variables: Record<string, string> = {};
				if (evaluator.variableMapping) {
					for (const [key, mappingFn] of Object.entries(evaluator.variableMapping)) {
						try {
							const mappedValue = mappingFn(output, dataEntry);
							if (mappedValue !== undefined) {
								variables[key] = mappedValue;
							}
						} catch (error) {
							throw new Error(`Error in variable mapping for key "${key}": ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				}

				// Use output.data for the result output
				const evaluatorOutput = output.data;
				const simulationOutputs = output.simulationOutputs;
				if ("names" in evaluator) {
					try {
						const results = await evaluator.evaluationFunction(
							evaluationResultArgs,
							{
								...dataEntry,
							},
							variables,
						);
						return Object.entries(results).map(([evaluatorName, result]) => {
							const name = evaluator.names.find((name) => name === evaluatorName);
							if (!name) {
								return {
									name: evaluatorName,
									passFailCriteria: evaluator.passFailCriteria[evaluatorName],
									output: evaluatorOutput,
									simulationOutputs,
									result: {
										score: "Err",
										reasoning: `No name found for "${evaluatorName}" in combined evaluator with names ${evaluator.names}`,
									},
								};
							}
							const passFailCriteria = evaluator.passFailCriteria[evaluatorName];
							if (!passFailCriteria) {
								return {
									name: evaluatorName,
									passFailCriteria: evaluator.passFailCriteria[evaluatorName],
									output: evaluatorOutput,
									simulationOutputs,
									result: {
										score: "Err",
										reasoning: `No pass fail criteria found with name "${evaluatorName}" for combined evaluator with names ${evaluator.names}`,
									},
								};
							}
							return {
								name,
								passFailCriteria,
								output: evaluatorOutput,
								simulationOutputs,
								result,
							};
						});
					} catch (err) {
						return evaluator.names.map((name) => {
							return {
								name,
								passFailCriteria: evaluator.passFailCriteria[name],
								output: evaluatorOutput,
								simulationOutputs,
								result: {
									score: "Err",
									reasoning: `Error while running combined evaluator with names ${evaluator.names}: ${
										err instanceof Error ? err.message : JSON.stringify(err)
									}`,
								},
							};
						});
					}
				} else {
					try {
						const result = await evaluator.evaluationFunction(
							evaluationResultArgs,
							{
								...dataEntry,
							},
							variables,
						);
						return [{ name: evaluator.name, passFailCriteria: evaluator.passFailCriteria, output: evaluatorOutput, simulationOutputs, result }];
					} catch (err) {
						return [
							{
								name: evaluator.name,
								passFailCriteria: evaluator.passFailCriteria,
								output: evaluatorOutput,
								simulationOutputs,
								result: {
									score: "Err",
									reasoning: `Error while running evaluator "${evaluator.name}": ${
										err instanceof Error ? err.message : JSON.stringify(err)
									}`,
								},
							},
						];
					}
				}
			}),
		);
		return evaluatorResults.flat();
	} catch (err) {
		return evaluators
			.map((evaluator) => {
				const fallbackOutput = output.data; // Simplified fallback on error
				const fallbackSimulationOutputs = output.simulationOutputs;
				if ("names" in evaluator) {
					return evaluator.names.map((name) => {
						return {
							name,
							passFailCriteria: evaluator.passFailCriteria[name],
							output: fallbackOutput,
							simulationOutputs: fallbackSimulationOutputs,
							result: {
								score: "Err",
								reasoning: `Error while running local evaluators overall: ${err instanceof Error ? err.message : JSON.stringify(err)}`,
							},
						};
					});
				}
				return [
					{
						name: evaluator.name,
						passFailCriteria: evaluator.passFailCriteria,
						output: fallbackOutput,
						simulationOutputs: fallbackSimulationOutputs,
						result: {
							score: "Err",
							reasoning: `Error while local evaluators overall: ${err instanceof Error ? err.message : JSON.stringify(err)}`,
						},
					},
				];
			})
			.flat();
	}
}

export function workflowIdOutputFunctionClosure<T extends DataStructure | undefined>(
	workflowId: string,
	TestRunAPIService: MaximTestRunAPI,
	contextToEvaluate?: string,
) {
	return async (data: Data<T>): Promise<YieldedOutput> => {
		const result = await TestRunAPIService.executeWorkflowForData({
			dataEntry: data,
			workflowId,
			contextToEvaluate,
		});
		return {
			data: result.output ?? "",
			retrievedContextToEvaluate: result.contextToEvaluate,
			messages: result.messages,
			meta: {
				usage: {
					latency: result.latency,
				},
			},
		};
	};
}

export function promptVersionIdOutputFunctionClosure<T extends DataStructure | undefined>(
	promptVersionId: string,
	input: string,
	TestRunAPIService: MaximTestRunAPI,
	contextToEvaluate?: string,
	simulationConfig?: TestRunConfig["simulationConfig"],
) {
	return async (data: Data<T>): Promise<YieldedOutput> => {
		const result = await TestRunAPIService.executePromptForData({
			dataEntry: data,
			input,
			promptVersionId,
			contextToEvaluate,
			simulationConfig,
		});
		return {
			data: result.output ?? "",
			retrievedContextToEvaluate: result.contextToEvaluate,
			messages: result.messages,
			meta: {
				usage: result.usage,
				cost: result.cost,
			},
		};
	};
}

export function promptChainVersionIdOutputFunctionClosure<T extends DataStructure | undefined>(
	promptChainVersionId: string,
	input: string,
	TestRunAPIService: MaximTestRunAPI,
	contextToEvaluate?: string,
) {
	return async (data: Data<T>): Promise<YieldedOutput> => {
		const result = await TestRunAPIService.executePromptChainForData({
			dataEntry: data,
			input,
			promptChainVersionId,
			contextToEvaluate,
		});
		return {
			data: result.output ?? "",
			retrievedContextToEvaluate: result.contextToEvaluate,
			messages: result.messages,
			meta: {
				usage: result.usage,
				cost: result.cost,
			},
		};
	};
}

/**
 * Polls the simulation status endpoint until completion, failure, or timeout.
 * Uses the same timeout as post-push polling (timeoutInMinutes).
 */
async function pollSimulationPromptStatus<T extends DataStructure | undefined>(
	TestRunAPIService: MaximTestRunAPI,
	workspaceId: string,
	testRunEntryId: string,
	pollingInterval: number,
	timeoutInMinutes: number,
): Promise<ExtractAPIDataType<MaximAPITestRunEntryExecuteSimulationPromptGetResponse>> {
	let pollCount = 0;
	const maxIterations = Math.ceil((Math.round(timeoutInMinutes) * 60) / pollingInterval);
	while (true) {
		pollCount++;
		const statusResult = await TestRunAPIService.getSimulationPromptStatus({ workspaceId, testRunEntryId });

		if (statusResult.status === "COMPLETE" || statusResult.status === "STOPPED") {
			return statusResult;
		}

		if (statusResult.status === "FAILED") {
			throw new Error(`Simulation failed for testRunEntryId: ${testRunEntryId}`);
		}
		if (!statusResult.status) {
			return statusResult;
		}
		if (pollCount > maxIterations) {
			throw new Error(
				`Simulation is taking over timeout period (${Math.round(timeoutInMinutes)} minutes) to complete for testRunEntryId: ${testRunEntryId}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, pollingInterval * 1000));
	}
}

async function pollSimulationWorkflowStatus<T extends DataStructure | undefined>(
	TestRunAPIService: MaximTestRunAPI,
	workspaceId: string,
	testRunEntryId: string,
	pollingInterval: number,
	timeoutInMinutes: number,
): Promise<ExtractAPIDataType<MaximAPITestRunEntryExecuteSimulationWorkflowGetResponse>> {
	let pollCount = 0;
	const maxIterations = Math.ceil((Math.round(timeoutInMinutes) * 60) / pollingInterval);
	while (true) {
		pollCount++;
		const statusResult = await TestRunAPIService.getSimulationWorkflowStatus({ workspaceId, testRunEntryId });

		if (statusResult.status === "COMPLETE" || statusResult.status === "STOPPED") {
			return statusResult;
		}

		if (statusResult.status === "FAILED") {
			throw new Error(`Simulation failed for testRunEntryId: ${testRunEntryId}`);
		}
		if (!statusResult.status) {
			return statusResult;
		}
		if (pollCount > maxIterations) {
			throw new Error(
				`Simulation is taking over timeout period (${Math.round(timeoutInMinutes)} minutes) to complete for testRunEntryId: ${testRunEntryId}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, pollingInterval * 1000));
	}
}

export function simulationPromptVersionIdOutputFunctionClosure<T extends DataStructure | undefined>(
	testRunId: string,
	promptVersionId: string,
	workspaceId: string,
	scenario: string | undefined,
	TestRunAPIService: MaximTestRunAPI,
	simulationConfig: NonNullable<TestRunConfig<T>["simulationConfig"]>,
	contextToEvaluate: string | string[] | undefined,
	datasetEntryId: string | undefined,
	input: string | undefined,
	expectedSteps: string | undefined,
	timeoutInMinutes: number = 15,
) {
	return async (data: Data<T>): Promise<YieldedOutput> => {
		try {
			// Step 1: Call POST endpoint to start simulation
			const postResult = await TestRunAPIService.executeSimulationPromptForData({
				testRunId,
				promptVersionId,
				workspaceId,
				datasetEntryId,
				entry: {
					input: input ?? null,
					scenario: scenario ?? null,
					expectedSteps: expectedSteps ?? null,
					contextToEvaluate: contextToEvaluate ?? null,
					dataEntry: data,
				},
				simulationConfig,
			});

			// Step 2: Poll GET endpoint until completion or timeout
			const pollingInterval = 5;
			const result = await pollSimulationPromptStatus(
				TestRunAPIService,
				postResult.workspaceId,
				postResult.testRunEntryId,
				pollingInterval,
				timeoutInMinutes,
			);

			const outputs = result.outputs ?? [];
			// Explicitly handle empty outputs to avoid indexing with lastIndex === -1.
			// When simulation returns no outputs, use empty string as safe default for data.
			const yieldedOutput: YieldedOutput =
				outputs.length === 0
					? {
							data: "",
							simulationOutputs: outputs,
							retrievedContextToEvaluate: undefined,
							messages: result.messages,
							simulationMeta: {
								sessionId: result.sessionId,
								simulationId: result.simulationId,
								messages: result.messages ?? [],
								trace: result.trace,
							},
							meta: {
								usage: result.usage,
								cost: result.cost,
							},
						}
					: {
							data: outputs[outputs.length - 1],
							simulationOutputs: outputs,
							retrievedContextToEvaluate: undefined,
							messages: result.messages,
							simulationMeta: {
								sessionId: result.sessionId,
								simulationId: result.simulationId,
								messages: result.messages ?? [],
								trace: result.trace,
							},
							meta: {
								usage: result.usage,
								cost: result.cost,
							},
						};

			return yieldedOutput;
		} catch (error) {
			throw error;
		}
	};
}

export function simulationWorkflowIdOutputFunctionClosure<T extends DataStructure | undefined>(
	testRunId: string,
	workflowId: string,
	workspaceId: string,
	scenario: string | undefined,
	TestRunAPIService: MaximTestRunAPI,
	simulationConfig: NonNullable<TestRunConfig<T>["simulationConfig"]>,
	contextToEvaluate: string | string[] | undefined,
	datasetEntryId: string | undefined,
	input: string | undefined,
	expectedSteps: string | undefined,
	timeoutInMinutes: number = 15,
) {
	return async (data: Data<T>): Promise<YieldedOutput> => {
		try {
			const postResult = await TestRunAPIService.executeSimulationWorkflowForData({
				testRunId,
				workflowId,
				workspaceId,
				datasetEntryId,
				entry: {
					input: input ?? null,
					scenario: scenario ?? null,
					expectedSteps: expectedSteps ?? null,
					contextToEvaluate: contextToEvaluate ?? null,
					dataEntry: data,
				},
				simulationConfig,
			});

			const pollingInterval = 5;
			const result = await pollSimulationWorkflowStatus(
				TestRunAPIService,
				postResult.workspaceId,
				postResult.testRunEntryId,
				pollingInterval,
				timeoutInMinutes,
			);
			const outputs = result.outputs ?? [];
			// Explicitly handle empty outputs to avoid indexing with lastIndex === -1.
			// When simulation returns no outputs, use empty string as safe default for data.
			const yieldedOutput: YieldedOutput =
				outputs.length === 0
					? {
							data: "",
							simulationOutputs: outputs,
							retrievedContextToEvaluate: undefined,
							messages: undefined,
							simulationMeta: {
								sessionId: result.sessionId,
								simulationId: result.simulationId,
								messages: [],
								trace: result.trace,
								turns: result.turns,
							},
							meta: {
								usage: result.usage
									? result.usage
									: undefined,
								cost: result.cost,
							},
						}
					: {
							data: outputs[outputs.length - 1],
							simulationOutputs: outputs,
							retrievedContextToEvaluate: undefined,
							messages: undefined,
							simulationMeta: {
								sessionId: result.sessionId,
								simulationId: result.simulationId,
								messages: [],
								trace: result.trace,
								turns: result.turns,
							},
							meta: {
								usage: result.usage
									? result.usage
									: undefined,
								cost: result.cost,
							},
						};

			return yieldedOutput;
		} catch (error) {
			throw error;
		}
	};
}
