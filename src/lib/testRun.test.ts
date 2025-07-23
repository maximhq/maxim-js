import "dotenv/config";
import fs from "node:fs";
import {
	createCustomCombinedEvaluatorsFor,
	createCustomEvaluator,
	createDataStructure,
	CSVFile,
	Data,
	LocalEvaluationResult,
	Maxim,
	TestRunLogger,
	YieldedOutput,
} from "../../index";
import { MaximEvaluatorAPI } from "./apis/evaluator";
import { Semaphore } from "./utils/semaphore";

// Load configuration for test environment
const config = JSON.parse(fs.readFileSync(`${process.cwd()}/testRunTestConfig.json`, "utf-8"));
const env = "prod";

if (!config[env].apiKey) throw new Error("Missing API_KEY environment variable");
if (!config[env].workspaceId) throw new Error("Missing WORKSPACE_ID environment variable");
if (!config[env].workflowId) throw new Error("Missing WORKFLOW_ID environment variable");
if (!config[env].datasetId) throw new Error("Missing DATASET_ID environment variable");
if (!config[env].promptVersionId) throw new Error("Missing PROMPT_VERSION_ID environment variable");

const baseUrl: string = config[env].baseUrl ?? "https://app.getmaxim.ai";
const apiKey: string = config[env].apiKey;
const workspaceId: string = config[env].workspaceId;
const workflowId: string = config[env].workflowId;
const datasetId: string = config[env].datasetId;
const promptVersionId: string = config[env].promptVersionId;

// Test case generation data
const outputProcessors = ["custom output processor", "prompt version", "workflow"] as const;
const dataSources = ["manual code array", "csv", "data function", "platform dataset"] as const;
const evaluatorCombinations = [
	["local evaluator single result return"],
	["local evaluator multiple result return"],
	["platform evaluator"],
	["human evaluator"],
	["local evaluator single result return", "local evaluator multiple result return"],
	["local evaluator single result return", "platform evaluator"],
	["local evaluator single result return", "human evaluator"],
	["local evaluator multiple result return", "platform evaluator"],
	["local evaluator multiple result return", "human evaluator"],
	["platform evaluator", "human evaluator"],
	["local evaluator single result return", "local evaluator multiple result return", "platform evaluator"],
	["local evaluator single result return", "local evaluator multiple result return", "human evaluator"],
	["local evaluator single result return", "platform evaluator", "human evaluator"],
	["local evaluator multiple result return", "platform evaluator", "human evaluator"],
	["local evaluator single result return", "local evaluator multiple result return", "platform evaluator", "human evaluator"],
] as const;

// Common data structure
const dataStructure = createDataStructure({
	Input: "INPUT",
	"Expected Output": "EXPECTED_OUTPUT",
	Context: "VARIABLE",
});

// Common mock LLM call for output processing - preserved from original code
async function mockLLMCall(input: string, context: string | string[]) {
	const model = "gpt-3.5-turbo";
	const maxTokens = 500;

	const stringContext = context ? (Array.isArray(context) ? context.join("\n") : context) : undefined;

	// Simulate network delay
	await new Promise((resolve) => setTimeout(resolve, 1000));

	// Calculate mock token counts
	const promptTokens = Math.ceil((input.length + (stringContext?.length ?? 0)) / 4);
	const completionTokens = Math.ceil(maxTokens * 0.7); // Simulate using 70% of max tokens

	// Generate a mock response based on input
	const mockResponse = `This is a mock response to: "${input}". ${
		stringContext ? `Taking into account the context: "${stringContext}".` : ""
	}`;

	return [
		{
			id: `chatcmpl-${Math.random().toString(36).substr(2, 9)}`,
			object: "chat.completion",
			created: Date.now(),
			model,
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: mockResponse,
					},
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				total_tokens: promptTokens + completionTokens,
			},
		},
		stringContext,
	] as const;
}

// Common mock LLM evaluation call - preserved from original code
async function mockLLMEvaluationCall(output: string, context: string | string[]) {
	await new Promise((resolve) => setTimeout(resolve, 500));
	return {
		score: Math.random() > 0.2,
		reasoning: "Mock evaluation reasoning",
		additionalMetrics: {
			metric1: Math.random(),
			metric2: Math.random(),
		},
	};
}

// Common local evaluator (single result) - preserved from original code
const localEvaluatorSingle = createCustomEvaluator<typeof dataStructure>(
	"local-evaluator-single",
	async (result, data) => {
		const response = await mockLLMEvaluationCall(result.output, data.Context);
		return {
			score: response.score,
			reasoning: response.reasoning,
		};
	},
	{
		onEachEntry: {
			scoreShouldBe: "=",
			value: true,
		},
		forTestrunOverall: {
			overallShouldBe: ">=",
			value: 80,
			for: "percentageOfPassedResults",
		},
	},
);

// Common local combined evaluator - preserved from original code
const localCombinedEvaluator = createCustomCombinedEvaluatorsFor("metric1-evaluator", "metric2-evaluator").build<typeof dataStructure>(
	async (result, data) => {
		const response = await mockLLMEvaluationCall(result.output, data.Context);
		return {
			"metric1-evaluator": {
				score: response.additionalMetrics.metric1,
				reasoning: "Metric 1 evaluation",
			},
			"metric2-evaluator": {
				score: response.additionalMetrics.metric2,
				reasoning: "Metric 2 evaluation",
			},
		};
	},
	{
		"metric1-evaluator": {
			onEachEntry: {
				scoreShouldBe: ">=",
				value: 0.5,
			},
			forTestrunOverall: {
				overallShouldBe: ">=",
				value: 80,
				for: "percentageOfPassedResults",
			},
		},
		"metric2-evaluator": {
			onEachEntry: {
				scoreShouldBe: ">=",
				value: 0.5,
			},
			forTestrunOverall: {
				overallShouldBe: ">=",
				value: 80,
				for: "percentageOfPassedResults",
			},
		},
	},
);

// Common manual code array - preserved from original code
const manualCodeArray = [
	{
		Input: "What is NVIDIA's GPU invention?",
		"Expected Output": "NVIDIA invented the GPU in 1999.",
		Context: "NVIDIA invented the GPU in 1999, revolutionizing computer graphics.",
	},
	{
		Input: "Describe NVIDIA's platform strategy.",
		"Expected Output": "NVIDIA's platform strategy combines hardware, software, and services.",
		Context: "NVIDIA's platform strategy integrates hardware, software, and services.",
	},
];

// Common manual data function - preserved from original code
const manualDataFunction = (page: number) => {
	const PAGE_SIZE = 2;
	if (page < 2) {
		return Array.from({ length: PAGE_SIZE }, (_, i) => ({
			Input: `Test input ${page * PAGE_SIZE + i}`,
			"Expected Output": `Test output ${page * PAGE_SIZE + i}`,
			Context: `Test context ${page * PAGE_SIZE + i}`,
		}));
	}
	return null;
};

// CSV file reference - preserved from original code
const csvFile = new CSVFile("./test.csv", {
	Input: 0,
	"Expected Output": 1,
	Context: 2,
});

// Custom logger for all test runs - preserved from original code
class TestLogger implements TestRunLogger<typeof dataStructure> {
	constructor(private testCase: string) {}

	error(message: string) {
		console.error(`[${this.testCase}][ERROR] ${message}`);
	}

	info(message: string) {
		console.info(`[${this.testCase}][INFO] ${message}`);
	}

	processed(
		message: string,
		data: {
			datasetEntry: Data<typeof dataStructure>;
			output?: YieldedOutput;
			evaluationResults?: LocalEvaluationResult[];
		},
	) {
		console.log(`[${this.testCase}][PROCESSED] ${message}`);
	}
}

// Helper function to create evaluator array - preserved from original code
function getEvaluators(evaluatorTypes: (typeof evaluatorCombinations)[number]) {
	return evaluatorTypes.map((type) => {
		switch (type) {
			case "local evaluator single result return":
				return localEvaluatorSingle;
			case "local evaluator multiple result return":
				return localCombinedEvaluator;
			case "platform evaluator":
				return "containsSpecialCharacters";
			case "human evaluator":
				return "Correctness";
			default:
				throw new Error(`Unknown evaluator type: ${type}`);
		}
	});
}

// Helper function to get data source - preserved from original code
function getDataSource(dataSourceType: "manual code array" | "csv" | "data function" | "platform dataset") {
	switch (dataSourceType) {
		case "manual code array":
			return manualCodeArray;
		case "csv":
			return csvFile;
		case "data function":
			return manualDataFunction;
		case "platform dataset":
			return datasetId;
		default:
			throw new Error(`Unknown data source type: ${dataSourceType}`);
	}
}

// Helper function to create test run - adapted from original code
async function createTestRun(
	maxim: Maxim,
	outputProcessor: (typeof outputProcessors)[number],
	dataSource: (typeof dataSources)[number],
	evaluators: (typeof evaluatorCombinations)[number],
) {
	const testCase = `${outputProcessor}-${dataSource}-${evaluators.join("-")}`;

	let testRun = maxim
		.createTestRun(`SDK Jest Test: ${testCase} - ${Date.now()}`, workspaceId)
		.withDataStructure(dataStructure)
		.withData(getDataSource(dataSource))
		.withEvaluators(...getEvaluators(evaluators))
		.withLogger(new TestLogger(testCase));

	if (outputProcessor === "custom output processor") {
		testRun = testRun.yieldsOutput(async (data) => {
			const startTime = Date.now();
			const response = await mockLLMCall(data.Input, data.Context);
			return {
				data: response[0].choices[0].message.content,
				meta: {
					usage: {
						totalTokens: response[0].usage.total_tokens,
						completionTokens: response[0].usage.completion_tokens,
						promptTokens: response[0].usage.prompt_tokens,
						latency: Date.now() - startTime,
					},
					cost: {
						input: response[0].usage.prompt_tokens * 0.03,
						output: response[0].usage.completion_tokens * 0.03,
						total: (response[0].usage.prompt_tokens + response[0].usage.completion_tokens) * 0.03,
					},
				},
			};
		});
	} else if (outputProcessor === "prompt version") {
		testRun = testRun.withPromptVersionId(promptVersionId);
	} else if (outputProcessor === "workflow") {
		testRun = testRun.withWorkflowId(workflowId);
	}

	if (evaluators.some((e) => e === "human evaluator")) {
		testRun = testRun.withHumanEvaluationConfig({
			emails: ["dhwanil@getmaxim.ai"],
			instructions: "Please evaluate the test outputs carefully.",
		});
	}

	const result = await testRun.run(120);
	return result;
}

// Generate test cases programmatically
describe("Maxim TestRun Tester", () => {
	let maxim: Maxim;

	beforeAll(() => {
		maxim = new Maxim({ apiKey, baseUrl });
	});

	afterAll(async () => {
		await maxim.cleanup();
	});

	// Single test that runs all combinations in parallel
	test(
		"should run all test combinations in parallel",
		async () => {
			// Create an array of all test combinations
			const testCombinations: {
				processor: (typeof outputProcessors)[number];
				source: (typeof dataSources)[number];
				evaluators: (typeof evaluatorCombinations)[number];
			}[] = [];

			const evaluatorAPI = new MaximEvaluatorAPI(baseUrl, apiKey, true);
			await evaluatorAPI.fetchPlatformEvaluator("containsSpecialCharacters", workspaceId);
			await evaluatorAPI.fetchPlatformEvaluator("Correctness", workspaceId);

			// Check if test.csv exists
			if (!fs.existsSync("./test.csv")) {
				throw new Error("test.csv file not found in current directory");
			}

			for (const processor of outputProcessors) {
				for (const source of dataSources) {
					for (const evaluators of evaluatorCombinations) {
						testCombinations.push({ processor, source, evaluators });
					}
				}
			}

			const semaphore = new Semaphore("test-run-semaphore", 10);

			// Run all test combinations in parallel using Promise.all
			const results = await Promise.all(
				testCombinations.map(async ({ processor, source, evaluators }) => {
					await semaphore.acquire();
					try {
						const result = await createTestRun(maxim, processor, source, evaluators)
							.then((result) => ({
								processor,
								source,
								evaluators,
								result,
							}))
							.catch((error) => ({
								processor,
								source,
								evaluators,
								error,
							}));
						return result;
					} finally {
						semaphore.release();
					}
				}),
			);

			const failed: Record<string, string[]> = {};
			// Log and assert results
			for (const result of results) {
				const testCase = `${result.processor}-${result.source}-${result.evaluators.join("-")}`;

				if ("error" in result) {
					console.error(`Test failed: ${testCase}`);
					console.error(result.error);
					// Mark as failure
					failed[testCase] = [result.error];
				} else {
					// Assertions
					expect(result.result).toBeDefined();
					expect(result.result.testRunResult).toBeDefined();
					expect(result.result.testRunResult.link).toBeDefined();
					expect(result.result.failedEntryIndices).toHaveLength(0);

					// Log results
					console.log(`Test run completed: ${testCase}`);
					console.log(`- Failed entries: ${result.result.failedEntryIndices.length}`);
					console.log(`- Link: ${result.result.testRunResult.link}`);
				}
			}
			if (Object.keys(failed).length > 0) {
				fail(`Tests failed: ${JSON.stringify(failed, null, 2)}`);
			}
		},
		60 * 60 * 1000, // Set timeout to 60 minutes for the entire test suite
	);
});
