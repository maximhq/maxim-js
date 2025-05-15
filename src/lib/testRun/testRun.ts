import { MaximDatasetAPI } from "../apis/dataset";
import { MaximEvaluatorAPI } from "../apis/evaluator";
import { MaximTestRunAPI } from "../apis/testRun";

import type { Data, DataStructure } from "../models/dataset";
import type { EvaluatorType, LocalEvaluationResult } from "../models/evaluator";
import type { TestRunBuilder, TestRunConfig, YieldedOutput } from "../models/testRun";

import { CSVFile } from "../utils/csvParser";
import { Semaphore } from "../utils/semaphore";
import { DefaultLogger } from "./defaultLogger";

import { sanitizeDataStructure, validateDataStructure } from "../dataset/dataset";
import { getAllKeysByValue } from "../utils/utils";
import { promptVersionIdOutputFunctionClosure, runLocalEvaluations, runOutputFunction, workflowIdOutputFunctionClosure } from "./runUtils";
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
	withWorkflowId: (id, contextToEvaluate) => createTestRunBuilder({ ...config, workflow: { id, contextToEvaluate } }),
	yieldsOutput: (outputFunction) => createTestRunBuilder({ ...config, outputFunction }),
	withLogger: (logger) => createTestRunBuilder({ ...config, logger }),
	getConfig: () => config,
	withConcurrency: (concurrency) => createTestRunBuilder({ ...config, concurrency }),
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
		if (!config.outputFunction && !config.promptVersion && !config.workflow) {
			errors.push(
				"Output function or prompt version id, or workflow id  is required to run a test. You can use either yieldsOutput, withPromptVersionId or withWorkflowId to set them respectively.",
			);
		}
		if ((config.outputFunction ? 1 : 0) + (config.promptVersion ? 1 : 0) + (config.workflow ? 1 : 0) !== 1) {
			errors.push("Exactly one of outputFunction, promptVersionId, or workflowId must be set.");
		}
		if (!config.data) {
			errors.push("Data or dataset id is required to run a test.");
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
		const APIEvaluatorService = new MaximEvaluatorAPI(config.baseUrl, config.apiKey);
		const platformEvaluatorsConfig = await Promise.all(
			config.evaluators
				.filter((e) => typeof e === "string")
				.map(async (e) => {
					const evaluatorConfig = await APIEvaluatorService.fetchPlatformEvaluator(e, config.workspaceId);
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
		const workflow = config.workflow;
		const failedEntryIndices: number[] = [];
		const localEvaluatorNameToIdAndPassFailCriteriaMap = getLocalEvaluatorNameToIdAndPassFailCriteriaMap(evaluators);

		const APITestRunService = new MaximTestRunAPI(config.baseUrl, config.apiKey);

		// ===== Common Processor =====
		async function processEntry(
			testRun: Awaited<ReturnType<typeof APITestRunService.createTestRun>>,
			index: number,
			mappingKeys: Partial<Record<"input" | "expectedOutput" | "contextToEvaluate", keyof Data<T>>>,
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

			// 2. get the output
			// Make sure if its local workflow or remote workflow
			if (outputFunction || evaluators.filter((e) => typeof e !== "string").length > 0) {
				let outputFunctionToExecute: (data: Data<T>) => YieldedOutput | Promise<YieldedOutput>;
				if (outputFunction) {
					outputFunctionToExecute = outputFunction;
				} else {
					if (workflow) {
						outputFunctionToExecute = workflowIdOutputFunctionClosure<T>(workflow.id, APITestRunService, workflow.contextToEvaluate);
					} else if (promptVersion) {
						outputFunctionToExecute = promptVersionIdOutputFunctionClosure<T>(
							promptVersion.id,
							input ?? "",
							APITestRunService,
							promptVersion.contextToEvaluate,
						);
					} else {
						throw new Error(
							"Found no output function to execute, please make sure you have either `yieldsOutput`, `withPromptVersionId` or `withWorkflowId` set.",
						);
					}
				}

				const output = await runOutputFunction(outputFunctionToExecute, row.data);
				if (output.retrievedContextToEvaluate) {
					if (contextToEvaluate) {
						logger.info(
							`Detected retrieved context returned from output function for row ${index + 1} that had contextToEvaluate set from the dataset.\nOverriding the contextToEvaluate from dataset with the retrieved context`,
						);
					}
					contextToEvaluate = output.retrievedContextToEvaluate;
				}

				// 3. run evaluations
				let localEvaluationResults: LocalEvaluationResult[] | undefined = undefined;
				if (evaluators.length > 0) {
					localEvaluationResults = await runLocalEvaluations(
						evaluators.filter((e) => typeof e !== "string"),
						row.data,
						{
							output: output.data,
							contextToEvaluate,
						},
					);
				}

				// 4. push the test run entry
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
						expectedOutput,
						contextToEvaluate,
						dataEntry: row.data,
						localEvaluationResults: localEvaluationResults
							? localEvaluationResults.map((result) => ({
									...result,
									id: localEvaluatorNameToIdAndPassFailCriteriaMap.get(result.name)!.id,
								}))
							: undefined,
					},
				});

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
							: typeof mappingKeys.contextToEvaluate === "string"
								? mappingKeys.contextToEvaluate
								: undefined,
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
				evaluators.filter((e) => typeof e !== "string").length > 0 ? true : false,
				workflow?.id,
				promptVersion?.id,
				humanEvaluationConfig,
			);

			try {
				// ===== Create Semaphore =====
				const semaphore = Semaphore.get(`${workspaceId}:${name}:${testRun.id}`, concurrency);

				if (data) {
					if (dataStructure) {
						const inputKey = getAllKeysByValue(dataStructure, "INPUT")[0];
						const expectedOutputKey = getAllKeysByValue(dataStructure, "EXPECTED_OUTPUT")[0];
						const contextToEvaluateKey = getAllKeysByValue(dataStructure, "CONTEXT_TO_EVALUATE")[0];

						if (typeof data === "string") {
							const APIDatasetService = new MaximDatasetAPI(config.baseUrl, config.apiKey);

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
													`=> Skipping page ${page - 1}\nError while sanitizing reponse as per data structure: ${err.message}\n\tGot response: ${JSON.stringify(fetchedData)}`,
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
													`=> Skipping page ${page - 1}\nError while sanitizing reponse as per data structure\n\tGot response: ${JSON.stringify(fetchedData)}`,
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
						const APIDatasetService = new MaximDatasetAPI(config.baseUrl, config.apiKey);

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
						`Test run is taking over timeout period (${Math.round(timeoutInMinutes)} minutes) to complete, please check the report on our web portal directly: ${config.baseUrl}/workspace/${config.workspaceId}/testrun/${testRun.id}`,
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
