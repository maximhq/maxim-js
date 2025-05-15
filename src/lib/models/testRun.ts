import type { Data, DataStructure, DataValue } from "../models/dataset";
import type {
	CombinedLocalEvaluatorType,
	HumanEvaluationConfig,
	LocalEvaluationResult,
	LocalEvaluatorType,
	PassFailCriteriaType,
} from "./evaluator";

export interface TestRunLogger<T extends DataStructure | undefined = undefined> {
	info: (message: string) => void;
	error: (message: string) => void;
	processed: (
		message: string,
		data: { datasetEntry: Data<T>; output?: YieldedOutput; evaluationResults?: LocalEvaluationResult[] },
	) => void;
}

export type YieldedOutput = {
	data: string;
	retrievedContextToEvaluate?: string | string[];
	meta?: {
		usage?:
			| {
					promptTokens: number;
					completionTokens: number;
					totalTokens: number;
					latency?: number;
			  }
			| {
					latency: number;
			  };
		cost?: {
			input: number;
			output: number;
			total: number;
		};
	};
};

export type TestRunResult = {
	link: string;
	result: {
		name: string;
		individualEvaluatorMeanScore: {
			[key: string]: { pass?: boolean } & (
				| {
						score: number;
						outOf?: number;
				  }
				| { score: boolean | string }
			);
		};
		usage?: {
			total: number;
			input: number;
			completion: number;
		};
		cost?: {
			total: number;
			input: number;
			completion: number;
		};
		latency?: {
			min: number;
			max: number;
			p50: number;
			p90: number;
			p95: number;
			p99: number;
			mean: number;
			standardDeviation: number;
			total: number;
		};
	}[];
};

/**
 * Configuration for a test run.
 */
export type TestRunConfig<T extends DataStructure | undefined = undefined> = {
	baseUrl: string;
	apiKey: string;
	workspaceId: string;
	name: string;
	testConfigId?: string;
	dataStructure?: T;
	data?: DataValue<T>;
	evaluators: (LocalEvaluatorType<T> | CombinedLocalEvaluatorType<T, Record<string, PassFailCriteriaType>> | string)[];
	humanEvaluationConfig?: HumanEvaluationConfig;
	outputFunction?: (data: Data<T>) => YieldedOutput | Promise<YieldedOutput>;
	promptVersion?: {
		id: string;
		contextToEvaluate?: string;
	};
	workflow?: {
		id: string;
		contextToEvaluate?: string;
	};
	logger?: TestRunLogger<T>;
	concurrency?: number;
};

export type TestRunBuilder<T extends DataStructure | undefined = undefined> = {
	/**
	 * Sets the data structure for the data being used in the test run.
	 * Note: Data structure is necessary for manual / CSV data as column types cannot be inferred without it.
	 *
	 * @see {@link withData}
	 * @param dataStructure The data structure to set.
	 * @returns The TestRunBuilder with the data structure set.
	 * @throws {Error} if the data structure contains more than one input, expectedOutput or contextToEvaluate column. (there can be multiple variable columns)
	 * @example
	 * maxim
	 * 	.createTestRun("name", "workspaceId")
	 * 	.withDataStructure({
	 * 		myInputCol: "INPUT",
	 * 		myExp: "EXPECTED_OUTPUT",
	 * 		context: "CONTEXT_TO_EVALUATE",
	 * 		additionalData: "VARIABLE", // or "NULLABLE_VARIABLE"
	 * 	});
	 */
	withDataStructure: <U extends DataStructure>(dataStructure: U) => TestRunBuilder<U>;

	/**
	 * Sets the data for the test run.
	 * @param data The data to set. Can be a datasetId(string), a CSV file, an array of column to value mappings, or a function that returns the data in the format of the data structure. (if the data structure is not provided, only datasetId would be a valid type)
	 * Note: If the data is a function, you will need to return null or undefined to indicate the end of the data.
	 * @see {@link withDataStructure}
	 * @returns The TestRunBuilder with the data set.
	 * @throws {Error} for any of the following reasons:
	 * - if the data argument is not a datasetId (when the data structure is not provided)
	 * - if the data does not match the data structure. (The data structure can differ from the remote data structure but the keys/column names shouldn't)
	 * - if the data is a CSVFile and it does not exist.
	 * @example
	 * maxim
	 *     .createTestRun("name", "workspaceId")
	 *     .withDataStructure({
	 *         myInputCol: "INPUT",
	 *         myExp: "EXPECTED_OUTPUT",
	 *         context: "CONTEXT_TO_EVALUATE",
	 *         additionalData: "NULLABLE_VARIABLE",
	 *     })
	 *     .withData(
	 *         new maxim.CSVFile("path/to/file.csv")
	 *         // OR
	 *         "datasetId"
	 *         // OR
	 *         [
	 *             {
	 *                 myInputCol: "input",
	 *                 myExp: "",
	 *                 context: "",
	 *             },
	 *             {
	 *                 myInputCol: "hello",
	 *                 myExp: "hi!",
	 *                 context: ["chunk1"],
	 *             },
	 *         ]
	 *         // OR
	 *         async (page) => {
	 *             // Get the data from the page
	 *             const data = await getDataFromPage(page);
	 *             return data; // returning null or undefined will be treated as the end of the data
	 *         }
	 *     );
	 */
	withData: (data: TestRunConfig<T>["data"]) => TestRunBuilder<T>;

	/**
	 * Sets the evaluators from the platform to be used in the test run.
	 *
	 * Note:
	 * - You may create an evaluator locally through code or use an evaluator that is installed in your workspace through the name directly.
	 * - If the evaluators contain a human evaluator, you will need to set the human evaluation config or the test run will fail.
	 * @see {@link createCustomEvaluator}
	 * @see {@link createCustomCombinedEvaluatorsFor}
	 * @see {@link withHumanEvaluationConfig}
	 * @param evaluators The evaluators to execute.
	 * @returns The TestRunBuilder with the evaluators set.
	 * @throws {Error} for any of the following reasons:
	 * - if multiple evaluators have the same name
	 * @example
	 * import {
		createCustomEvaluator,
		createCustomCombinedEvaluatorsFor,
	 * } from "@maximai/maxim-js";
	 *
	 * const dataStructure = createDataStructure({
     *  Input: 'INPUT',
     *  'Expected Output': 'EXPECTED_OUTPUT',
     *  Context: 'VARIABLE',
     * });
     *
     * const customApostropheChecker = createCustomEvaluator<typeof dataStructure>(
     *  'apostrophe-checker',
     *  (result, data) => { // data contains the current data entry on which the output was obtained
     *      if (result.output.includes("'")) {
     *          return {
     *              score: true,
     *              reasoning: 'The output contains an apostrophe',
     *          };
     *      } else {
     *          return {
     *              score: false,
     *              reasoning: 'The output does not contain an apostrophe',
     *          };
     *      }
     *  },
     *  {
     *      onEachEntry: {
     *          scoreShouldBe: '=',
     *          value: true,
     *      },
     *      forTestrunOverall: {
     *          overallShouldBe: '>=',
     *          value: 80,
     *          for: 'percentageOfPassedResults',
     *      },
     *  },
     * );
     *
	 * maxim
	 *     .createTestRun("name", "workspaceId")
	 *     .withEvaluators(
	 *         "Faithfulness",
	 *         customApostropheChecker,
	 *     );
	 */
	withEvaluators: (...evaluators: TestRunConfig<T>["evaluators"]) => TestRunBuilder<T>;

	/**
	 * Sets the human evaluation config for the test run.
	 * @param humanEvaluationConfig The human evaluation config.
	 * @returns The ComparisonTestRunBuilder with the human evaluation config set.
	 * @throws {Error} if the emails passed are not valid
	 * @example
	 * maxim
	 *     .createTestRun("name", "workspaceId")
	 *     .withEvaluators("HumanEvaluator")
	 *     .withHumanEvaluationConfig({
	 *         emails: ["user@example.com"],
	 *         instructions: "Please provide a brief reasoning behind the scoring.",
	 *     });
	 */
	withHumanEvaluationConfig: (humanEvaluationConfig: HumanEvaluationConfig) => TestRunBuilder<T>;

	/**
	 * Sets the output retrieval function for the test run.
	 *
	 * Note: Throwing from this function will cause the test run entry being executed to fail and not added to the test run on the server. You will still get back the indices of all the failed entries once the run is finished.
	 * @param outputFunction The output retrieval function.
	 * @returns The TestRunBuilder with the output retrieval function set.
	 * @example
	 * maxim
	 *     .createTestRun("name", "workspaceId")
	 *     .yieldsOutput((data) => {
	 *         // This is just an example, you can use
	 *         // the columns from the dataset to
	 *         // retrieve the output anyway you want
	 *         const output = await modelCall(
	 *             data.myInputCol,
	 *             data.context,
	 *         );
	 *         return {
	 *             // The actual output
	 *             data: output.text,
	 *             // Retrieved context (if any)
	 *             retrievedContext: output.retrievedContext,
	 *             // Additional metadata (if any)
	 *             meta: {
	 *                 usage: {
	 *                     promptTokens: output.usage.promptTokens,
	 *                     completionTokens: output.usage.completionTokens,
	 *                     totalTokens: output.usage.totalTokens,
	 *                     latency: output.usage.latency,
	 *                 },
	 *                 cost: {
	 *                     input: output.cost.input,
	 *                     output: output.cost.output,
	 *                     total: output.cost.input + output.cost.output,
	 *                 },
	 *             },
	 *         };
	 *     });
	 */
	yieldsOutput: (outputFunction: TestRunConfig<T>["outputFunction"]) => TestRunBuilder<T>;

	/**
	 * Sets the prompt version ID for the test run. Optionally, you can also set the context to evaluate for the prompt. (Note: setting the context to evaluate will end up overriding the CONTEXT_TO_EVALUATE dataset column value)
	 * @param id The prompt version ID to set.
	 * @param contextToEvaluate The context to evaluate for the prompt (variable name essentially).
	 * @returns The TestRunBuilder with the prompt version set.
	 * @example
	 * maxim
	 *     .createTestRun("name", "workspaceId")
	 *     .withPromptVersionId("promptVersionId", "contextVariableName");
	 */
	withPromptVersionId: (id: string, contextToEvaluate?: string) => TestRunBuilder<T>;

	/**
	 * Sets the workflow ID for the test run. Optionally, you can also set the context to evaluate for the workflow. (Note: setting the context to evaluate will end up overriding the CONTEXT_TO_EVALUATE dataset column value)
	 * @param id The workflow ID to set.
	 * @param contextToEvaluate The context to evaluate for the workflow (variable name essentially).
	 * @returns The TestRunBuilder with the workflow set.
	 * @example
	 * maxim
	 *     .createTestRun("name", "workspaceId")
	 *     .withWorkflowId("workflowId", "contextVariableName");
	 */
	withWorkflowId: (id: string, contextToEvaluate?: string) => TestRunBuilder<T>;

	/**
	 * Sets the logger for the test run. (optional, we have a default logger implemented already).
	 *
	 * @param logger The logger satisfying TestRunLogger interface.
	 * @see {@link TestRunLogger}
	 * @returns The TestRunBuilder with the logger set.
	 * @example
	 * maxim
	 *     .createTestRun("name", "workspaceId")
	 *     .withLogger({
	 *          info(message) {
	 *             console.info(message);
	 *         },
	 *         error(message) {
	 *             console.error(message);
	 *         },
	 *         processed(message, data) {
	 *             console.info(message);
	 *             // OR
	 *             // console.log("ran entry =>", data.datasetEntry, data.output, data.evaluationResults);
	 *         },
	 *     })
	 */
	withLogger: (logger: TestRunConfig<T>["logger"]) => TestRunBuilder<T>;

	/**
	 * Sets the concurrency for the test run. (optional, defaults to 10).
	 * @param concurrency The concurrency to set.
	 * @returns The TestRunBuilder with the concurrency set.
	 * @example
	 * maxim
	 *     .createTestRun("name", "workspaceId")
	 *     .withConcurrency(10); // defaults to 10
	 */
	withConcurrency: (concurrency: TestRunConfig<T>["concurrency"]) => TestRunBuilder<T>;

	/**
	 * Gets the current TestRunConfig.
	 * @returns The current TestRunConfig.
	 */
	getConfig: () => TestRunConfig<T>;

	/**
	 * Runs the test run with the configured configuration.
	 * @async
	 * @param {number} timeoutInMinutes - The timeout in minutes for the test run. Will be rounded to the nearest whole number if given a floating value (optional, defaults to 15 minutes)
	 * @returns The test run result.
	 * @throws {Error} for any of the following reasons:
	 * - If the test run is not configured properly (sanitization error)
	 * - If the test run is taking too long to complete, i.e., passed the timeout limit (you can still view the report on our web portal though)
	 * - If the test run itself fails due to any reason.
	 * @example
	 * const testRunResult = await maxim.createTestRun("testRunName", "workspaceId")
	 *     .withDataStructure({
	 *         myInputCol: "INPUT",
	 *         myExp: "EXPECTED_OUTPUT",
	 *         context: "CONTEXT_TO_EVALUATE",
	 *         additionalData: "NULLABLE_VARIABLE",
	 *     })
	 *     .withData(
	 *         "datasetId"
	 *     )
	 *     .withEvaluators(
	 *         "Faithfulness",
	 *         "HumanValidation",
	 *     )
	 *     .withHumanEvaluationConfig({
	 *         emails: ["user@example.com"],
	 *         instructions: "Please provide a brief reasoning behind the scoring.",
	 *     })
	 *     .yieldsOutput(async (data) => {
	 *         const output = await runModel(data.myInputCol, data.context);
	 *         return {
	 *             data: output.text,
	 *             retrievedContext: output.retrievedContext,
	 *             meta: output.meta,
	 *         };
	 *     })
	 *     .run(60 * 2); // while waiting for the test run to finish
	 *     // once all entries are pushed; wait for 2 hours before
	 *     // timing out and throwing an error (test run can still
	 *     // be viewed on our web portal)
	 */
	run: (timeoutInMinutes?: number) => Promise<{ testRunResult: TestRunResult; failedEntryIndices: number[] }>;
};

export type MaximAPICreateTestRunResponse =
	| {
			data: {
				id: string;
				workspaceId: string;
				humanEvaluationConfig?: {
					emails: string[];
					instructions: string;
					requester: string;
				};
				evalConfig: unknown;
				parentTestRunId?: string;
			};
	  }
	| {
			error: {
				message: string;
			};
	  };

export type MaximAPITestRunEntryPushPayload<T extends DataStructure | undefined = undefined> = {
	testRun: {
		id: string;
		datasetEntryId?: string;
		datasetId?: string;
		workspaceId: string;
		humanEvaluationConfig?: {
			emails: string[];
			instructions: string;
			requester: string;
		};
		evalConfig: unknown;
		parentTestRunId?: string;
	};
	runConfig?: {
		usage?:
			| {
					prompt_tokens: number;
					completion_tokens: number;
					total_tokens: number;
					latency?: number;
			  }
			| {
					latency?: number;
			  };
		cost?: {
			input: number;
			output: number;
			total: number;
		};
	};
	entry: MaximAPITestRunEntry;
};

export type MaximAPITestRunEntry = {
	input?: string;
	expectedOutput?: string;
	contextToEvaluate?: string | string[];
	output?: string;
	dataEntry: Record<string, string | string[] | null | undefined>;
	localEvaluationResults?: (LocalEvaluationResult & { id: string })[];
};

export type MaximAPITestRunStatusResponse =
	| {
			data: {
				entryStatus: {
					total: number;
					running: number;
					completed: number;
					failed: number;
					queued: number;
					stopped: number;
				};
				testRunStatus: "QUEUED" | "RUNNING" | "FAILED" | "COMPLETE" | "STOPPED";
			};
	  }
	| {
			error: {
				message: string;
			};
	  };

export type MaximAPITestRunResultResponse =
	| {
			data: TestRunResult;
	  }
	| {
			error: {
				message: string;
			};
	  };

export type MaximAPITestRunEntryExecuteWorkflowForDataPayload = {
	workflowId: string;
	dataEntry: Record<string, string | string[] | null | undefined>;
	contextToEvaluate?: string;
};

export type MaximAPITestRunEntryExecuteWorkflowForDataResponse =
	| {
			data: {
				output?: string;
				contextToEvaluate?: string;
				latency: number;
			};
	  }
	| {
			error: {
				message: string;
			};
	  };

export type MaximAPITestRunEntryExecutePromptForDataPayload = {
	promptVersionId: string;
	input: string;
	dataEntry?: Record<string, string | string[] | null | undefined>;
	contextToEvaluate?: string;
};

export type MaximAPITestRunEntryExecutePromptForDataResponse =
	| {
			data: {
				output?: string;
				contextToEvaluate?: string;
				usage?: {
					promptTokens: number;
					completionTokens: number;
					totalTokens: number;
					latency?: number;
				};
				cost?: {
					input: number;
					output: number;
					total: number;
				};
			};
	  }
	| {
			error: {
				message: string;
			};
	  };
