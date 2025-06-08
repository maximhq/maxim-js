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

export async function runLocalEvaluations<T extends DataStructure | undefined>(
	evaluators: (LocalEvaluatorType<T> | CombinedLocalEvaluatorType<T, Record<string, PassFailCriteriaType>>)[],
	dataEntry: Data<T>,
	processedData: {
		output: string;
		contextToEvaluate?: string | string[];
	},
): Promise<LocalEvaluationResult[]> {
	try {
		const evaluatorResults = await Promise.all(
			evaluators.map(async (evaluator): Promise<LocalEvaluationResult[]> => {
				if ("names" in evaluator) {
					try {
						const results = await evaluator.evaluationFunction(
							{
								output: processedData.output,
								contextToEvaluate: processedData.contextToEvaluate,
							},
							{
								...dataEntry,
							},
						);
						return Object.entries(results).map(([evaluatorName, result]) => {
							const name = evaluator.names.find((name) => name === evaluatorName);
							if (!name) {
								return {
									name: evaluatorName,
									passFailCriteria: evaluator.passFailCriteria[evaluatorName],
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
									result: {
										score: "Err",
										reasoning: `No pass fail criteria found with name "${evaluatorName}" for combined evaluator with names ${evaluator.names}`,
									},
								};
							}
							return {
								name,
								passFailCriteria,
								result,
							};
						});
					} catch (err) {
						return evaluator.names.map((name) => {
							return {
								name,
								passFailCriteria: evaluator.passFailCriteria[name],
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
							{
								output: processedData.output,
								contextToEvaluate: processedData.contextToEvaluate,
							},
							{
								...dataEntry,
							},
						);
						return [{ name: evaluator.name, passFailCriteria: evaluator.passFailCriteria, result }];
					} catch (err) {
						return [
							{
								name: evaluator.name,
								passFailCriteria: evaluator.passFailCriteria,
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
				if ("names" in evaluator) {
					return evaluator.names.map((name) => {
						return {
							name,
							passFailCriteria: evaluator.passFailCriteria[name],
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
			meta: {
				usage: result.usage,
				cost: result.cost,
			},
		};
	};
}
