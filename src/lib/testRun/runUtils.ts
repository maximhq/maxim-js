import { MaximTestRunAPI } from "../apis/testRun";
import type { Data, DataStructure } from "../models/dataset";
import type { CombinedLocalEvaluatorType, LocalEvaluationResult, LocalEvaluatorType, PassFailCriteriaType } from "../models/evaluator";
import type { TestRunConfig, YieldedOutput } from "../models/testRun";

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
	output: YieldedOutput & { [key: string]: unknown },
	contextToEvaluate?: string | string[],
): Promise<LocalEvaluationResult[]> {
	try {
		const evaluatorResults = await Promise.all(
			evaluators.map(async (evaluator): Promise<LocalEvaluationResult[]> => {
				// Get the output for this evaluator (use variableMapping if provided)
				let evaluationResultArgs: Record<string, any>;

				if (evaluator.variableMapping) {
					evaluationResultArgs = {};
					for (const [key, mappingFn] of Object.entries(evaluator.variableMapping)) {
						try {
							evaluationResultArgs[key] = mappingFn(output, dataEntry);
						} catch (error) {
							throw new Error(`Error in variable mapping for key "${key}": ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				} else {
					evaluationResultArgs = {
						output: output.data,
						contextToEvaluate: contextToEvaluate,
					};
				}

				// We need to capture the 'output' value specifically for LocalEvaluationResult.output
				// If 'output' key exists in args, use it. Otherwise use output.data
				const evaluatorOutput = evaluationResultArgs["output"] ?? output.data;

				if ("names" in evaluator) {
					try {
						const results = await evaluator.evaluationFunction(evaluationResultArgs, {
							...dataEntry,
						});
						return Object.entries(results).map(([evaluatorName, result]) => {
							const name = evaluator.names.find((name) => name === evaluatorName);
							if (!name) {
								return {
									name: evaluatorName,
									passFailCriteria: evaluator.passFailCriteria[evaluatorName],
									output: evaluatorOutput,
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
								result,
							};
						});
					} catch (err) {
						return evaluator.names.map((name) => {
							return {
								name,
								passFailCriteria: evaluator.passFailCriteria[name],
								output: evaluatorOutput,
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
						const result = await evaluator.evaluationFunction(evaluationResultArgs, {
							...dataEntry,
						});
						return [{ name: evaluator.name, passFailCriteria: evaluator.passFailCriteria, output: evaluatorOutput, result }];
					} catch (err) {
						return [
							{
								name: evaluator.name,
								passFailCriteria: evaluator.passFailCriteria,
								output: evaluatorOutput,
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
				if ("names" in evaluator) {
					return evaluator.names.map((name) => {
						return {
							name,
							passFailCriteria: evaluator.passFailCriteria[name],
							output: fallbackOutput,
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
) {
	return async (data: Data<T>): Promise<YieldedOutput> => {
		const result = await TestRunAPIService.executePromptForData({
			dataEntry: data,
			input,
			promptVersionId,
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
