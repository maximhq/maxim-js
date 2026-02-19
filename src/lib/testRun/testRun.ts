import { MaximDatasetAPI } from "../apis/dataset";
import { MaximEvaluatorAPI } from "../apis/evaluator";
import { MaximTestRunAPI } from "../apis/testRun";

import { Variable, VariableType, type Data, type DataStructure } from "../models/dataset";
import type {
	CombinedLocalEvaluatorType,
	EvaluatorType,
	LocalEvaluationResult,
	LocalEvaluatorType,
	PassFailCriteriaType,
	PlatformEvaluator,
} from "../models/evaluator";
import type { TestRunBuilder, TestRunConfig, YieldedOutput } from "../models/testRun";

import { CSVFile } from "../utils/csvParser";
import { Semaphore } from "../utils/semaphore";
import { DefaultLogger } from "./defaultLogger";

import { sanitizeDataStructure, validateDataStructure } from "../dataset/dataset";
import { getAllKeysByValue } from "../utils/utils";
import {
	promptChainVersionIdOutputFunctionClosure,
	promptVersionIdOutputFunctionClosure,
	runLocalEvaluations,
	runOutputFunction,
	simulationPromptVersionIdOutputFunctionClosure,
	simulationWorkflowIdOutputFunctionClosure,
	simulationYieldsOutputFunctionClosure,
	workflowIdOutputFunctionClosure,
} from "./runUtils";
import { sanitizeData, sanitizeEvaluators } from "./sanitizationUtils";
import { buildErrorMessage, calculatePollingInterval, createStatusTable, getLocalEvaluatorNameToIdAndPassFailCriteriaMap } from "./utils";

/**
 * Creates a new TestRunBuilder with the given configuration.
 * @param config The configuration for the TestRunBuilder.
 * @returns A TestRunBuilder with the given configuration.
 */
export const createTestRunBuilder = <T extends DataStructure | undefined = undefined>(config: TestRunConfig<T>): TestRunBuilder<T> => ({
	withDataStructure: <U extends DataStructure>(dataStructure?: U) => {
		sanitizeDataStructure(dataStructure);
		return createTestRunBuilder<U>({ ...(config as unknown as TestRunConfig<U>), dataStructure });
	},
	withData: (data) => {
		sanitizeData(data, config.dataStructure);
		return createTestRunBuilder({ ...config, data });
	},
	withEvaluators: (...evaluators) => {
		sanitizeEvaluators(evaluators);
		return createTestRunBuilder({ ...config, evaluators: [...evaluators] });
	},
	withHumanEvaluationConfig: (humanEvaluationConfig) => {
		const emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
		humanEvaluationConfig.emails.forEach((email) => {
			if (!emailRegex.test(email)) {
				throw new Error(`Invalid email address: ${email}`);
			}
		});
		return createTestRunBuilder({ ...config, humanEvaluationConfig });
	},
	withPromptVersionId: (id, contextToEvaluate) => createTestRunBuilder({ ...config, promptVersion: { id, contextToEvaluate } }),
	withPromptChainVersionId: (id, contextToEvaluate) => createTestRunBuilder({ ...config, promptChainVersion: { id, contextToEvaluate } }),
	withWorkflowId: (id, contextToEvaluate) => createTestRunBuilder({ ...config, workflow: { id, contextToEvaluate } }),
	withSimulationConfig: (simulationConfig) => createTestRunBuilder({ ...config, simulationConfig }),
	yieldsOutput: (outputFunction) => createTestRunBuilder({ ...config, outputFunction }),
	withLogger: (logger) => createTestRunBuilder({ ...config, logger }),
	getConfig: () => config,
	withConcurrency: (concurrency) => createTestRunBuilder({ ...config, concurrency }),
	withTags: (tags) => createTestRunBuilder({ ...config, tags }),
	run: async (timeoutInMinutes = 15) => {
		let errors: string[] = [];
		const logger = config.logger ?? new DefaultLogger();

		// ===== Sanitization =====
		logger.info("Running sanitization checks...");
		if (!config.name) {
			errors.push("Name is required to run a test.");
		}
		if (!config.workspaceId) {
			errors.push("Workspace Id is required to run a test.");
		}
		if (!config.outputFunction && !config.promptVersion && !config.promptChainVersion && !config.workflow) {
			errors.push(
				"Output function or prompt version id, prompt chain version id, or workflow id is required to run a test. You can use either yieldsOutput, withPromptVersionId, withPromptChainVersionId or withWorkflowId to set them respectively.",
			);
		}
		const hasOutputFunction = !!config.outputFunction;
		const hasPromptVersion = !!config.promptVersion;
		const hasPromptChainVersion = !!config.promptChainVersion;
		const hasWorkflow = !!config.workflow;
		const outputSourceCount = (hasOutputFunction ? 1 : 0) + (hasPromptVersion ? 1 : 0) + (hasPromptChainVersion ? 1 : 0) + (hasWorkflow ? 1 : 0);

		// Simulation + yieldsOutput: requires outputFunction + (promptVersion OR workflow)
		if (config.simulationConfig && hasOutputFunction) {
			if (!hasPromptVersion && !hasWorkflow) {
				errors.push("Simulation config with yieldsOutput requires either withPromptVersionId or withWorkflowId to be set.");
			}
			if (hasPromptChainVersion) {
				errors.push("Simulation config with yieldsOutput cannot use withPromptChainVersionId. Use withPromptVersionId or withWorkflowId.");
			}
			if (hasPromptVersion && hasWorkflow) {
				errors.push("Simulation config with yieldsOutput cannot use both withPromptVersionId and withWorkflowId. Set exactly one.");
			}
		} else if (outputSourceCount !== 1) {
			errors.push("Exactly one of outputFunction, promptVersionId, promptChainVersionId, or workflowId must be set.");
		}
		if (!config.data) {
			errors.push("Data or dataset id is required to run a test.");
		}
		if (config.simulationConfig) {
			if (config.promptChainVersion) {
				errors.push("Simulation config cannot be used with withPromptChainVersionId. Use withWorkflowId, withPromptVersionId, or yieldsOutput instead.");
			}
			if (!config.workflow && !config.promptVersion && !config.outputFunction) {
				errors.push("Simulation config requires either withWorkflowId, withPromptVersionId, or yieldsOutput to be set.");
			}
			if (config.simulationConfig.responseFields && config.simulationConfig.responseFields.length > 0 && !config.workflow) {
				errors.push("responseFields in simulationConfig can only be used with withWorkflowId, not with withPromptVersionId or yieldsOutput.");
			}
		}

		if (errors.length > 0) {
			throw new Error(
				`Missing required configuration for test run ${config.name ? ` "${config.name}"` : ""}:\n\t${errors.join(", \n\t")}`,
				{
					cause: JSON.stringify({ config }, null, 2),
				},
			);
		}

		sanitizeDataStructure(config.dataStructure);
		sanitizeData(config.data, config.dataStructure);

		sanitizeEvaluators(config.evaluators);
		const APIEvaluatorService = new MaximEvaluatorAPI(config.baseUrl, config.apiKey, config.isDebug);
		const platformEvaluatorsConfig = await Promise.all(
			config.evaluators
				.filter((e) => typeof e === "string" || (typeof e === "object" && !("evaluationFunction" in e)))
				.map(async (e) => {
					const evaluatorName = typeof e === "string" ? e : (e as PlatformEvaluator).name;
					const evaluatorConfig = await APIEvaluatorService.fetchPlatformEvaluator(evaluatorName, config.workspaceId);
					return evaluatorConfig;
				}),
		);
		if (platformEvaluatorsConfig.some((e) => e.type === "Human")) {
			if (!config.humanEvaluationConfig) {
				throw new Error("Human evaluator found in evaluators, but no human evaluation config was provided.");
			}
		}

		// ===== Extracting Variables =====
		const dataStructure = config.dataStructure as DataStructure | undefined;
		const concurrency = config.concurrency ?? 10;
		const name = config.name;
		const workspaceId = config.workspaceId;
		const data = config.data;
		const testConfigId = config.testConfigId;
		const evaluators = config.evaluators;
		const humanEvaluationConfig = config.humanEvaluationConfig;
		const outputFunction = config.outputFunction;
		const promptVersion = config.promptVersion;
		const promptChainVersion = config.promptChainVersion;
		const workflow = config.workflow;
		const tags = config.tags;
		const failedEntryIndices: number[] = [];
		const localEvaluatorNameToIdAndPassFailCriteriaMap = getLocalEvaluatorNameToIdAndPassFailCriteriaMap(
			evaluators.filter(
				(e): e is LocalEvaluatorType<T> | CombinedLocalEvaluatorType<T, Record<string, PassFailCriteriaType>> =>
					typeof e !== "string" && "evaluationFunction" in e,
			),
		);

		const APITestRunService = new MaximTestRunAPI(config.baseUrl, config.apiKey, config.isDebug);

		// ===== Common Processor =====
		async function processEntry(
			testRun: Awaited<ReturnType<typeof APITestRunService.createTestRun>>,
			index: number,
			mappingKeys: Partial<Record<"input" | "expectedOutput" | "contextToEvaluate" | "scenario" | "expectedSteps", keyof Data<T>>>,
			getRow: (
				index: number,
			) => Promise<{ data: Data<T>; id?: string } | null | undefined> | ({ data: Data<T>; id?: string } | null | undefined),
			datasetId?: string,
		) {
			// 1. fetch row
			const row = await getRow(index);
			// if row is not found, return
			if (!row) {
				throw new Error(`No row found at index ${index}`);
			}

			const input = mappingKeys.input ? (row.data[mappingKeys.input] ? String(row.data[mappingKeys.input]) : undefined) : undefined;
			const expectedOutput = mappingKeys.expectedOutput
				? row.data[mappingKeys.expectedOutput]
					? String(row.data[mappingKeys.expectedOutput])
					: undefined
				: undefined;
			let contextToEvaluate = (
				mappingKeys.contextToEvaluate
					? row.data[mappingKeys.contextToEvaluate] === null
						? undefined
						: row.data[mappingKeys.contextToEvaluate]
					: undefined
			) as string | string[] | undefined;
			const scenario = mappingKeys.scenario
				? row.data[mappingKeys.scenario]
					? String(row.data[mappingKeys.scenario])
					: undefined
				: undefined;
			const expectedSteps = mappingKeys.expectedSteps
				? row.data[mappingKeys.expectedSteps]
					? String(row.data[mappingKeys.expectedSteps])
					: undefined
				: undefined;

			// 2. get the output
			if(config.simulationConfig && outputFunction) {
				// Determine entity type (prompt or workflow)
				const entityType = workflow ? "workflow" : "prompt";
				const promptVersionId = promptVersion?.id;
				const workflowIdForSim = workflow?.id;

				let contextToEvaluateForSimulation = contextToEvaluate ?? promptVersion?.contextToEvaluate ?? workflow?.contextToEvaluate;
				
				// Build the simulation closure
				const outputFunctionToExecute = simulationYieldsOutputFunctionClosure<T>(
					testRun.id,
					workspaceId,
					config.simulationConfig,
					outputFunction,
					APITestRunService,
					entityType,
					promptVersionId,
					workflowIdForSim,
					row.id,
					input,
					scenario,
					expectedSteps,
					contextToEvaluateForSimulation,
					timeoutInMinutes,
					logger,
				);

				// Execute the simulation
				const output = await runOutputFunction(outputFunctionToExecute, row.data);

				if (output.retrievedContextToEvaluate) {
					if (contextToEvaluateForSimulation) {
						logger.info(
							`Detected retrieved context returned from output function for row ${
								index + 1
							} that had contextToEvaluate set from the dataset.\nOverriding the contextToEvaluate from dataset with the retrieved context`,
						);
					}
					contextToEvaluateForSimulation = output.retrievedContextToEvaluate;
				}

				// 3. run evaluations
				let localEvaluationResults: LocalEvaluationResult[] | undefined = undefined;
				const localEvaluators = evaluators.filter((e) => typeof e !== "string" && "evaluationFunction" in e) as (
					| LocalEvaluatorType<T>
					| CombinedLocalEvaluatorType<T, Record<string, PassFailCriteriaType>>
				)[];

				if (localEvaluators.length > 0) {
					localEvaluationResults = await runLocalEvaluations(
						localEvaluators,
						row.data,
						output as any,
						contextToEvaluateForSimulation,
					)
				}

				// 4. Build output for push
				// Find all platform evaluators with variableMapping
				const platformEvaluatorsWithMangler = evaluators.filter(
					(e): e is PlatformEvaluator =>
						typeof e !== "string" && !("evaluationFunction" in e) && "variableMapping" in e && typeof e.variableMapping === "object",
				);

				let evaluatorOutputOverrides: Record<string, Record<string, string | undefined>> | undefined;
				evaluatorOutputOverrides = {};
				for (const platformEval of platformEvaluatorsWithMangler) {
					if (!platformEval.variableMapping) continue;
					const mappingKeysList = Object.keys(platformEval.variableMapping);
					if (mappingKeysList.length > 0) {
						const evalConfig = platformEvaluatorsConfig.find((c) => c.name === platformEval.name);
						if (!evalConfig) continue;

						const mappingResult: Record<string, string | undefined> = {};
						
						// Resolve persona with priority: dataset column > simulation config
						let datasetPersona: string | undefined;
						for (const [key, value] of Object.entries(row.data)) {
							if (key.toLowerCase() === "persona" && value != null) {
								const personaStr = String(value).trim();
								if (personaStr) {
									datasetPersona = personaStr;
									break;
								}
							}
						}
						
						let simconfigPersona: string | undefined;
						if (config.simulationConfig?.persona && !datasetPersona) {
							if (typeof config.simulationConfig.persona === "string") {
								simconfigPersona = config.simulationConfig.persona;
							} else {
								const val = row.data[config.simulationConfig.persona.payload];
								simconfigPersona = val != null ? String(val).trim() || undefined : undefined;
							}
						}
						
						const persona = datasetPersona ?? simconfigPersona ?? "";

						const runObj = {
							input,
							output: output.data,
							retrieval: contextToEvaluateForSimulation,
							toolCalls: [],
							scenario,
							persona,
							messages: output.messages,
							...output,
						};

						for (const key of mappingKeysList) {
							const mappingFn = platformEval.variableMapping[key];
							if (!mappingFn) continue;
							try {
								const version = workflow
									? {
											id: workflow.id,
											type: "workflow" as const,
										}
									: promptVersion
										? {
												id: promptVersion.id,
												type: "prompt" as const,
											}
										: undefined;

								mappingResult[key] = mappingFn(runObj, row.data, version);
							} catch (e) {
								logger.error(`Error in variable mapping for key "${key}": ${e instanceof Error ? e.message : String(e)}`);
							}
						}
						evaluatorOutputOverrides[evalConfig.id] = mappingResult;
					}
				}

				// Simulation: cost/usage in simulationMeta, no runConfig
				try {
					await APITestRunService.pushTestRunEntry({
						testRun: { ...testRun, datasetId, datasetEntryId: row.id },
						entry: {
							input,
							output: output.data,
							meta: {
								sdkVariables:
									evaluatorOutputOverrides && Object.keys(evaluatorOutputOverrides).length > 0
										? Object.entries(evaluatorOutputOverrides).reduce(
												(acc, [id, val]) => {
													acc[id] = {
														type: VariableType.JSON,
														payload: JSON.stringify(val),
													};
													return acc;
												},
												{} as Record<string, Variable>,
											)
										: undefined,
							},
							expectedOutput,
							contextToEvaluate: contextToEvaluateForSimulation,
							scenario,
							expectedSteps,
							dataEntry: row.data,
							localEvaluationResults: localEvaluationResults
							? localEvaluationResults.map((result) => ({
								...result,
								id: localEvaluatorNameToIdAndPassFailCriteriaMap.get(result.name)!.id,
							}))
							: undefined,
							simulationMeta: output.simulationMeta,
						},
						localSimulation: true,
					});
				} catch (pushError) {
					const testRunEntryId = output?.simulationMeta?.testRunEntryId;
					if (testRunEntryId) {
						try {
							await APITestRunService.updateSimulationStatus(testRunEntryId, "FAILED");
						} catch (cleanupError) {
							const msg = `Failed to mark simulation as failed after push error (testRunEntryId: ${testRunEntryId}): ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
							"error" in logger && typeof logger.error === "function" ? logger.error(msg) : logger.info(msg);
						}
					}
					throw pushError;
				}

				// 5. log the test run entry with local evaluation results
				logger.processed(`Ran test run entry ${index + 1}`, {
					datasetEntry: row.data as Data<T>,
					output,
					evaluationResults: localEvaluationResults,
				});

				return;
			} // Make sure if its local workflow or remote workflow
			else if (outputFunction || evaluators.filter((e) => typeof e !== "string").length > 0) {
				let outputFunctionToExecute: (data: Data<T>) => YieldedOutput | Promise<YieldedOutput>;
				if (outputFunction) {
					outputFunctionToExecute = outputFunction;
				}
				else {
					// Check if we need to use simulation endpoints (simulationConfig + local evaluators)
					const hasLocalEvaluators =
						evaluators.filter((e) => typeof e !== "string" && "evaluationFunction" in e).length > 0;
					const useSimulationEndpoints = config.simulationConfig && hasLocalEvaluators;

					if (workflow) {
						if (useSimulationEndpoints) {
							const contextToEvaluateForSimulation = contextToEvaluate ?? workflow.contextToEvaluate;
							outputFunctionToExecute = simulationWorkflowIdOutputFunctionClosure<T>(
								testRun.id,
								workflow.id,
								workspaceId,
								scenario,
								APITestRunService,
								config.simulationConfig!,
								contextToEvaluateForSimulation,
								row.id,
								input,
								expectedSteps,
								timeoutInMinutes,
							);
						} else {
							outputFunctionToExecute = workflowIdOutputFunctionClosure<T>(
								workflow.id,
								APITestRunService,
								workflow.contextToEvaluate,
							);
						}
					} else if (promptVersion) {
						if (useSimulationEndpoints) {
							// Use contextToEvaluate from row data, or fallback to promptVersion.contextToEvaluate
							const contextToEvaluateForSimulation = contextToEvaluate ?? promptVersion.contextToEvaluate;
							outputFunctionToExecute = simulationPromptVersionIdOutputFunctionClosure<T>(
								testRun.id,
								promptVersion.id,
								workspaceId,
								scenario,
								APITestRunService,
								config.simulationConfig!,
								contextToEvaluateForSimulation,
								row.id,
								input,
								expectedSteps,
								timeoutInMinutes,
							);
						} else {
							outputFunctionToExecute = promptVersionIdOutputFunctionClosure<T>(
								promptVersion.id,
								input ?? "",
								APITestRunService,
								promptVersion.contextToEvaluate,
							);
						}
					} else if (promptChainVersion) {
						outputFunctionToExecute = promptChainVersionIdOutputFunctionClosure<T>(
							promptChainVersion.id,
							input ?? "",
							APITestRunService,
							promptChainVersion.contextToEvaluate,
						);
					} else {
						throw new Error(
							"Found no output function to execute, please make sure you have either `yieldsOutput`, `withPromptVersionId`, `withPromptChainVersionId` or `withWorkflowId` set.",
						);
					}
				}

				const output = await runOutputFunction(outputFunctionToExecute, row.data);

				if (output.retrievedContextToEvaluate) {
					if (contextToEvaluate) {
						logger.info(
							`Detected retrieved context returned from output function for row ${
								index + 1
							} that had contextToEvaluate set from the dataset.\nOverriding the contextToEvaluate from dataset with the retrieved context`,
						);
					}
					contextToEvaluate = output.retrievedContextToEvaluate;
				}

				// 3. run evaluations
				let localEvaluationResults: LocalEvaluationResult[] | undefined = undefined;
				const localEvaluators = evaluators.filter((e) => typeof e !== "string" && "evaluationFunction" in e) as (
					| LocalEvaluatorType<T>
					| CombinedLocalEvaluatorType<T, Record<string, PassFailCriteriaType>>
				)[];

				if (localEvaluators.length > 0) {
					localEvaluationResults = await runLocalEvaluations(
						localEvaluators,
						row.data,
						output as any,
						contextToEvaluate,
					)
				}

				// 4. push the test run entry
				// Use the first evaluator's mangled output if available
				// 4. Build output for push
				// Find all platform evaluators with variableMapping
				const platformEvaluatorsWithMangler = evaluators.filter(
					(e): e is PlatformEvaluator =>
						typeof e !== "string" && !("evaluationFunction" in e) && "variableMapping" in e && typeof e.variableMapping === "object",
				);

				let evaluatorOutputOverrides: Record<string, Record<string, string | undefined>> | undefined;
				evaluatorOutputOverrides = {};
				for (const platformEval of platformEvaluatorsWithMangler) {
					if (!platformEval.variableMapping) continue;
					const mappingKeysList = Object.keys(platformEval.variableMapping);
					if (mappingKeysList.length > 0) {
						const evalConfig = platformEvaluatorsConfig.find((c) => c.name === platformEval.name);
					if (!evalConfig) continue;

					const mappingResult: Record<string, string | undefined> = {};
					
					// Resolve persona with priority: dataset column > simulation config
					let datasetPersona: string | undefined;
					for (const [key, value] of Object.entries(row.data)) {
						if (key.toLowerCase() === "persona" && value != null) {
							const personaStr = String(value).trim();
							if (personaStr) {
								datasetPersona = personaStr;
								break;
							}
						}
					}
					
					let simconfigPersona: string | undefined;
					if (config.simulationConfig?.persona) {
						if (typeof config.simulationConfig.persona === "string") {
							simconfigPersona = config.simulationConfig.persona;
						} else {
							const val = row.data[config.simulationConfig.persona.payload];
							simconfigPersona = val != null ? String(val).trim() || undefined : undefined;
						}
					}
					
					const persona = datasetPersona ?? simconfigPersona ?? "";

					const runObj = {
						input,
						output: output.data,
						retrieval: contextToEvaluate,
						toolCalls: [],
						scenario,
						persona,
						messages: output.messages,
						...output,
					};

						for (const key of mappingKeysList) {
							const mappingFn = platformEval.variableMapping[key];
							if (!mappingFn) continue;
							try {
								const version = workflow
									? {
											id: workflow.id,
											type: "workflow" as const,
										}
									: promptVersion
										? {
												id: promptVersion.id,
												type: "prompt" as const,
											}
										: promptChainVersion
											? {
													id: promptChainVersion.id,
													type: "promptChain" as const,
												}
											: undefined;

								mappingResult[key] = mappingFn(runObj, row.data, version);
							} catch (e) {
								logger.error(`Error in variable mapping for key "${key}": ${e instanceof Error ? e.message : String(e)}`);
							}
						}
						evaluatorOutputOverrides[evalConfig.id] = mappingResult;
					}
				}

				try {
					await APITestRunService.pushTestRunEntry({
						testRun: { ...testRun, datasetId, datasetEntryId: row.id },
						runConfig: output.meta
							? {
									cost: output.meta.cost,
									usage: output.meta.usage
										? "completionTokens" in output.meta.usage
											? {
													completion_tokens: output.meta.usage.completionTokens,
													prompt_tokens: output.meta.usage.promptTokens,
													total_tokens: output.meta.usage.totalTokens,
													latency: output.meta.usage.latency,
												}
											: {
													latency: output.meta.usage.latency,
												}
										: undefined,
								}
							: undefined,
						entry: {
							input,
							output: output.data,
							meta: {
								sdkVariables:
									evaluatorOutputOverrides && Object.keys(evaluatorOutputOverrides).length > 0
										? Object.entries(evaluatorOutputOverrides).reduce(
												(acc, [id, val]) => {
													acc[id] = {
														type: VariableType.JSON,
														payload: JSON.stringify(val),
													};
													return acc;
												},
												{} as Record<string, Variable>,
											)
										: undefined,
							},
							expectedOutput,
							contextToEvaluate,
							scenario,
							expectedSteps,
							dataEntry: row.data,
							localEvaluationResults: localEvaluationResults
								? localEvaluationResults.map((result) => ({
										...result,
										id: localEvaluatorNameToIdAndPassFailCriteriaMap.get(result.name)!.id,
									}))
								: undefined,
							simulationMeta: output.simulationMeta,
						},
					});
				} catch (pushError) {
					const testRunEntryId = output?.simulationMeta?.testRunEntryId;
					if (testRunEntryId) {
						try {
							await APITestRunService.updateSimulationStatus(testRunEntryId, "FAILED");
						} catch (cleanupError) {
							const msg = `Failed to mark simulation as failed after push error (testRunEntryId: ${testRunEntryId}): ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
							"error" in logger && typeof logger.error === "function" ? logger.error(msg) : logger.info(msg);
						}
					}
					throw pushError;
				}

				// 5. log the test run entry with local evaluation results
				logger.processed(`Ran test run entry ${index + 1}`, {
					datasetEntry: row.data as Data<T>,
					output,
					evaluationResults: localEvaluationResults,
				});

				return;
			}
			// Else we will be just pushing back the dataset entry from the SDK side
			await APITestRunService.pushTestRunEntry({
				testRun: { ...testRun, datasetId, datasetEntryId: row.id },
				entry: {
					input,
					expectedOutput,
					contextToEvaluate: workflow?.contextToEvaluate
						? workflow.contextToEvaluate
						: promptVersion?.contextToEvaluate
							? promptVersion.contextToEvaluate
							: promptChainVersion?.contextToEvaluate
								? promptChainVersion.contextToEvaluate
								: typeof mappingKeys.contextToEvaluate === "string"
									? mappingKeys.contextToEvaluate
									: undefined,
					scenario,
					expectedSteps,
					dataEntry: row.data,
				},
			});
			logger.processed(`Ran test run entry ${index + 1}`, {
				datasetEntry: row.data as Data<T>,
			});
		}

		// ===== Test Run Starts =====
		try {
			logger.info(`Creating test run "${name}"...`);
			// ===== Create Test Run =====
			// create eval config (needed for local evals)
			const evalConfig = [
				...platformEvaluatorsConfig,
				...Array.from(localEvaluatorNameToIdAndPassFailCriteriaMap.entries()).map(
					([name, value]): {
						id: string;
						name: string;
						type: EvaluatorType;
						builtin: boolean;
						reversed: boolean | undefined;
						config: unknown;
					} => ({
						id: value.id,
						name,
						type: "Local",
						builtin: false,
						reversed: undefined,
						config: {
							passFailCriteria: {
								entryLevel: {
									value:
										typeof value.passFailCriteria.onEachEntry.value === "boolean"
											? value.passFailCriteria.onEachEntry.value
												? "Yes"
												: "No"
											: value.passFailCriteria.onEachEntry.value,
									operator: value.passFailCriteria.onEachEntry.scoreShouldBe,
									name: "score",
								},
								runLevel: {
									value: value.passFailCriteria.forTestrunOverall.value,
									operator: value.passFailCriteria.forTestrunOverall.overallShouldBe,
									name: value.passFailCriteria.forTestrunOverall.for === "average" ? "meanScore" : "queriesPassed",
								},
							},
						},
					}),
				),
			];

			const testRun = await APITestRunService.createTestRun(
				name,
				workspaceId,
				"SINGLE",
				evalConfig,
				evaluators.filter((e) => typeof e !== "string" && "evaluationFunction" in e).length > 0 ? true : false,
				workflow?.id,
				promptVersion?.id,
				promptChainVersion?.id,
				humanEvaluationConfig,
				tags,
				config.simulationConfig,
			);

			try {
				// ===== Create Semaphore =====
				const semaphore = Semaphore.get(`${workspaceId}:${name}:${testRun.id}`, concurrency);

				if (data) {
					if (dataStructure) {
						const inputKey = getAllKeysByValue(dataStructure, "INPUT")[0];
						const expectedOutputKey = getAllKeysByValue(dataStructure, "EXPECTED_OUTPUT")[0];
						const contextToEvaluateKey = getAllKeysByValue(dataStructure, "CONTEXT_TO_EVALUATE")[0];
						const scenarioKey = getAllKeysByValue(dataStructure, "SCENARIO")[0];
						const expectedStepsKey = getAllKeysByValue(dataStructure, "EXPECTED_STEPS")[0];

						if (typeof data === "string") {
							const APIDatasetService = new MaximDatasetAPI(config.baseUrl, config.apiKey, config.isDebug);

							logger.info(`Fetching dataset "${data}" from platform...`);
							const platformDataStructure = await APIDatasetService.getDatasetDatastructure(data);
							validateDataStructure(dataStructure, platformDataStructure);

							await APITestRunService.attachDatasetToTestRun(testRun.id, data);

							// ===== Platform Dataset Processor =====
							async function processDatasetEntry(index: number, datasetId: string) {
								try {
									// 1. acquire semaphore
									await semaphore.acquire();
									// 2. process the entry
									await processEntry(
										testRun,
										index,
										{
											input: inputKey,
											expectedOutput: expectedOutputKey,
											contextToEvaluate: contextToEvaluateKey,
											scenario: scenarioKey,
											expectedSteps: expectedStepsKey,
										},
										async (index) => {
											return (await APIDatasetService.getDatasetRow(datasetId, index)) as { data: Data<T>; id: string };
										},
										datasetId,
									);
								} catch (err: unknown) {
									// 3. handle error (if any)
									logger.error(
										buildErrorMessage(
											new Error(`Error while running data entry at index [${index}]`, {
												cause: err,
											}),
										),
									);
									failedEntryIndices.push(index);
								} finally {
									// 4. release semaphore
									semaphore.release();
								}
							}

							// 1. get length of dataset
							const totalRows = await APIDatasetService.getDatasetTotalRows(data);
							// 2. process each row in parallel
							const dataEntryPromises: Promise<void>[] = [];
							for (let i = 0; i < totalRows; i++) {
								dataEntryPromises.push(processDatasetEntry(i, data));
							}
							// 3. wait for all promises to resolve
							await Promise.all(dataEntryPromises);
						} else if (data instanceof CSVFile) {
							const columnStructure: Record<keyof typeof dataStructure, number> = {};
							Object.keys(dataStructure).forEach((key, index) => {
								columnStructure[key] = index;
							});
							const csv = await CSVFile.restructure(data, columnStructure);

							// ===== CSV Dataset Processor =====
							async function processCSVEntry(index: number) {
								try {
									// 1. acquire semaphore
									await semaphore.acquire();
									// 2. process the entry
									await processEntry(
										testRun,
										index,
										{
											input: inputKey,
											expectedOutput: expectedOutputKey,
											contextToEvaluate: contextToEvaluateKey,
											scenario: scenarioKey,
											expectedSteps: expectedStepsKey,
										},
										async (index) => {
											return { data: (await csv.getRow(index)) as Data<T> };
										},
									);
								} catch (err: unknown) {
									// 3. handle error (if any)
									logger.error(
										buildErrorMessage(
											new Error(`Error while running data entry at index [${index}]`, {
												cause: err,
											}),
										),
									);
									failedEntryIndices.push(index);
								} finally {
									// 4. release semaphore
									semaphore.release();
								}
							}

							// 1. get length of dataset
							const totalRows = await csv.getRowCount();
							// 2. process each row in parallel
							const dataEntryPromises: Promise<void>[] = [];
							for (let i = 0; i < totalRows; i++) {
								dataEntryPromises.push(processCSVEntry(i));
							}
							// 3. wait for all promises to resolve
							await Promise.all(dataEntryPromises);
						} else if (Array.isArray(data)) {
							// ===== Manual Array Dataset Processor =====
							async function processDataEntry(index: number, getRow: (index: number) => { data: Data<T> }) {
								try {
									// 1. acquire semaphore
									await semaphore.acquire();
									// 2. process the entry
									await processEntry(
										testRun,
										index,
										{
											input: inputKey,
											expectedOutput: expectedOutputKey,
											contextToEvaluate: contextToEvaluateKey,
											scenario: scenarioKey,
											expectedSteps: expectedStepsKey,
										},
										getRow,
									);
								} catch (err: unknown) {
									// 3. handle error (if any)
									logger.error(
										buildErrorMessage(
											new Error(`Error while running data entry at index [${index}]`, {
												cause: err,
											}),
										),
									);
									failedEntryIndices.push(index);
								} finally {
									// 4. release semaphore
									semaphore.release();
								}
							}

							// 1. get length of dataset
							const totalRows = data.length;
							// 2. process each row in parallel
							const dataEntryPromises: Promise<void>[] = [];
							for (let i = 0; i < totalRows; i++) {
								dataEntryPromises.push(
									processDataEntry(i, (index) => ({
										data: data[index] as Data<T>,
									})),
								);
							}
							// 3. wait for all promises to resolve
							await Promise.all(dataEntryPromises);
						} else if (typeof data === "function") {
							// ===== Manual Function Dataset Processor =====
							async function processDataEntry(mainIndex: number, index: number, getRow: (index: number) => { data: Data<T> }) {
								try {
									// 1. acquire semaphore
									await semaphore.acquire();
									// 2. process the entry
									await processEntry(
										testRun,
										index,
										{
											input: inputKey,
											expectedOutput: expectedOutputKey,
											contextToEvaluate: contextToEvaluateKey,
											scenario: scenarioKey,
											expectedSteps: expectedStepsKey,
										},
										getRow,
									);
								} catch (err: unknown) {
									// 3. handle error (if any)
									logger.error(
										buildErrorMessage(
											new Error(`Error while running data entry at index [${mainIndex}]`, {
												cause: err,
											}),
										),
									);
									failedEntryIndices.push(mainIndex);
								} finally {
									// 4. release semaphore
									semaphore.release();
								}
							}

							let page = 0;
							let index = 0;
							while (true) {
								const dataEntryPromises: Promise<void>[] = [];

								// 1. fetch data
								const fetchedData = await data(page++);
								if (fetchedData === null || fetchedData === undefined) {
									break;
								}
								try {
									// 2. sanitize data
									sanitizeData(fetchedData, dataStructure);
								} catch (err: unknown) {
									// 3. handle error (if any)
									if (err && err instanceof Error) {
										logger.error(
											buildErrorMessage(
												new Error(
													`=> Skipping page ${page - 1}\nError while sanitizing reponse as per data structure: ${
														err.message
													}\n\tGot response: ${JSON.stringify(fetchedData)}`,
													{
														cause: err,
													},
												),
											),
										);
									} else {
										logger.error(
											buildErrorMessage(
												new Error(
													`=> Skipping page ${
														page - 1
													}\nError while sanitizing reponse as per data structure\n\tGot response: ${JSON.stringify(fetchedData)}`,
													{
														cause: err,
													},
												),
											),
										);
									}
									continue;
								}

								// 4. process each row in parallel
								for (let i = 0; i < fetchedData.length; i++) {
									dataEntryPromises.push(
										processDataEntry(index, i, (index) => ({
											data: fetchedData[index] as Data<T>,
										})),
									);
									index++;
								}
								// 5. wait for all promises to resolve
								await Promise.all(dataEntryPromises);
							}
						} else {
							// handle invalid data type with data structure
							throw new Error(`Invalid data type ${typeof data}. Expected string, CSVFile or array of valid data type.`);
						}
					} else {
						// only allow string as data type if no data structure is provided
						const datasetId = data as string;
						const APIDatasetService = new MaximDatasetAPI(config.baseUrl, config.apiKey, config.isDebug);

						logger.info(`Fetching dataset "${datasetId}" from platform...`);
						const dataStructure = await APIDatasetService.getDatasetDatastructure(datasetId);

						await APITestRunService.attachDatasetToTestRun(testRun.id, datasetId);

						const inputKey = getAllKeysByValue(dataStructure, "INPUT")[0];
						const expectedOutputKey = getAllKeysByValue(dataStructure, "EXPECTED_OUTPUT")[0];

						// ===== Platform Dataset Processor =====
						async function processDatasetEntry(index: number, datasetId: string) {
							try {
								// 1. acquire semaphore
								await semaphore.acquire();
								// 2. process the entry
								await processEntry(
									testRun,
									index,
									{
										input: inputKey,
										expectedOutput: expectedOutputKey,
									},
									async (index) => {
										return (await APIDatasetService.getDatasetRow(datasetId, index)) as { data: Data<T>; id: string };
									},
									datasetId,
								);
							} catch (err: unknown) {
								logger.error(
									buildErrorMessage(
										new Error(`Error while running data entry at index [${index}]`, {
											cause: err,
										}),
									),
								);
								failedEntryIndices.push(index);
							} finally {
								// 3. release semaphore
								semaphore.release();
							}
						}

						// 1. get length of dataset
						const totalRows = await APIDatasetService.getDatasetTotalRows(datasetId);
						// 2. process each row in parallel
						const dataEntryPromises: Promise<void>[] = [];
						for (let i = 0; i < totalRows; i++) {
							dataEntryPromises.push(processDatasetEntry(i, datasetId));
						}
						// 3. wait for all promises to resolve
						await Promise.all(dataEntryPromises);
					}
				}

				// ===== Test Run Ends Locally =====
				logger.info("Marking test run as processed...");
				await APITestRunService.markTestRunProcessed(testRun.id);

				logger.info(
					`You can now either quit and view the report on our web portal here: \n\t\t${config.baseUrl}/workspace/${config.workspaceId}/testrun/${testRun.id}\n\tOR\n\tWait for the test run to complete to get back the results to use through the SDK.`,
				);
			} catch (e) {
				await APITestRunService.markTestRunFailed(testRun.id);
				throw e;
			}

			// ===== Polling To Check if Test Run Ends on Platform =====
			let pollCount = 0;
			const pollingInterval = calculatePollingInterval(
				timeoutInMinutes,
				platformEvaluatorsConfig.some((e) => e.type === "AI"),
			);
			const maxIterations = Math.ceil((Math.round(timeoutInMinutes) * 60) / pollingInterval);

			logger.info("Waiting for test run to complete...");
			logger.info(`Polling interval: ${pollingInterval} seconds`);
			let status: Awaited<ReturnType<typeof APITestRunService.getTestRunStatus>>;

			do {
				status = await APITestRunService.getTestRunStatus(testRun.id);
				logger.info(`Test run is ${status.testRunStatus}, breakdown:\n${createStatusTable(status.entryStatus)}`);

				// if the test run is taking more than timeout period complete, we will redirect them to the web portal instead
				if (++pollCount > maxIterations) {
					throw new Error(
						`Test run is taking over timeout period (${Math.round(
							timeoutInMinutes,
						)} minutes) to complete, please check the report on our web portal directly: ${config.baseUrl}/workspace/${
							config.workspaceId
						}/testrun/${testRun.id}`,
					);
				}

				if (
					!(
						status.testRunStatus === "FAILED" ||
						status.testRunStatus === "STOPPED" ||
						(status.testRunStatus === "COMPLETE" &&
							status.entryStatus.total === status.entryStatus.completed + status.entryStatus.failed + status.entryStatus.stopped)
					)
				) {
					await new Promise((resolve) => setTimeout(resolve, pollingInterval * 1000));
				}
			} while (
				!(
					status.testRunStatus === "FAILED" ||
					status.testRunStatus === "STOPPED" ||
					(status.testRunStatus === "COMPLETE" &&
						status.entryStatus.total === status.entryStatus.completed + status.entryStatus.failed + status.entryStatus.stopped)
				)
			);

			// If test run failed, throw error
			if (status.testRunStatus === "FAILED") {
				throw new Error(
					`💥 Test run failed, please check the report on our web portal: ${config.baseUrl}/workspace/${config.workspaceId}/testrun/${testRun.id}`,
				);
			}

			// If test run was stopped, throw error
			if (status.testRunStatus === "STOPPED") {
				throw new Error(
					`🛑 Test run was stopped, please check the report on our web portal: ${config.baseUrl}/workspace/${config.workspaceId}/testrun/${testRun.id}`,
				);
			}

			// ===== Test Run Ends On Platform =====
			const testRunResult = await APITestRunService.getTestRunFinalResult(testRun.id);
			testRunResult.link = config.baseUrl + testRunResult.link;

			logger.info(`Test run "${name}" completed successfully!🎉 \nView the report here: ${testRunResult.link}`);

			return { testRunResult, failedEntryIndices };
		} catch (err) {
			logger.error(
				buildErrorMessage(
					new Error(`Error while running test run ${name}`, {
						cause: err,
					}),
				),
			);
			throw err;
		}
	},
});
