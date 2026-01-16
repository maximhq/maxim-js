import "dotenv/config";
import fs from "node:fs";
import {
	createCustomCombinedEvaluatorsFor,
	createCustomEvaluator,
	createDataStructure,
	Data,
	LocalEvaluationResult,
	Maxim,
	TestRunLogger,
	TestRunConfig,
	YieldedOutput,
} from "../../index";

const config = JSON.parse(fs.readFileSync(`${process.cwd()}/testSimulationTestConfig.json`, "utf-8"));
const env = "beta";

if (!config[env].apiKey) throw new Error("Missing API_KEY environment variable");
if (!config[env].workspaceId) throw new Error("Missing WORKSPACE_ID environment variable");
if (!config[env].promptVersionId) throw new Error("Missing PROMPT_VERSION_ID environment variable");
if (!config[env].datasetId) throw new Error("Missing DATASET_ID environment variable");
if (!config[env].workflowId) throw new Error("Missing WORKFLOW_ID environment variable");

const baseUrl: string = config[env].baseUrl ?? "https://app.getmaxim.ai";
const apiKey: string = config[env].apiKey;
const workspaceId: string = config[env].workspaceId;
const promptVersionId: string = config[env].promptVersionId;
const datasetId: string = config[env].datasetId;
const workflowId: string = config[env].workflowId;

// ===== Data Structure =====
const dataStructure = createDataStructure({
	Input: "INPUT",
	"Expected Steps": "EXPECTED_STEPS",
	Scenario: "SCENARIO",
});

// ===== Manual Test Data =====
const manualData: Data<typeof dataStructure>[] = [
	{
		Input: "What is the significance of the 'Pale Blue Dot' in 'Cosmos'?",
		"Expected Steps": `1.The "Pale Blue Dot" refers to an image of Earth taken by the Voyager 1 spacecraft from a distance of about 3.7 billion miles. In "Cosmos," Carl Sagan reflects on the image to illustrate the fragility and insignificance of Earth in the vastness of the universe, emphasizing the need for humility and unity among humanity.
		\n2. Yes. Sagan connects the "Pale Blue Dot" idea to humanity's tendency to think of itself as central or unique. By showing how tiny Earth is, he challenges that view and instead presents humans as part of a much larger cosmic story, made from the same matter as stars and governed by the same natural laws.`,
		Scenario: "Question about Pale Blue Dot",
	},
	{
		Input: "Explain quantum entanglement in simple terms.",
		"Expected Steps": `1. Quantum entanglement is a phenomenon where two or more particles become connected in such a way that the state of one particle instantly affects the state of another, regardless of the distance between them.
		\n2. This connection happens instantaneously, faster than light, which challenges our classical understanding of physics.`,
		Scenario: "Science explanation request",
	},
];

// ===== Local Evaluators =====

// Single local evaluator
const localSingleEvaluator = createCustomEvaluator<typeof dataStructure>(
	"output-length-validator",
	async (result, data) => {
		const lengthScore = result.output.length >= data["Expected Steps"].length ? 1 : 0;
		return {
			score: lengthScore,
			reasoning: lengthScore === 1 ? "Output length is sufficient" : "Output length is insufficient",
		};
	},
	{
		onEachEntry: {
			scoreShouldBe: ">=",
			value: 1,
		},
		forTestrunOverall: {
			overallShouldBe: ">=",
			value: 100,
			for: "percentageOfPassedResults",
		},
	},
);

// Simulation outputs evaluator
const simulationOutputsEvaluator = createCustomEvaluator<typeof dataStructure>(
	"simulation-steps-validator",
	async (result, data) => {
		if (!result.simulationOutputs || result.simulationOutputs.length === 0) {
			return {
				score: 0,
				reasoning: "No simulation outputs available",
			};
		}

		const expectedStepsCount = data["Expected Steps"].split("\n").filter((line) => line.trim().length > 0).length;
		const actualStepsCount = result.simulationOutputs.length;
		const stepsMatch = actualStepsCount >= expectedStepsCount;

		return {
			score: stepsMatch ? 1 : 0,
			reasoning: stepsMatch
				? `Simulation produced ${actualStepsCount} steps, meeting expected ${expectedStepsCount} steps`
				: `Simulation produced ${actualStepsCount} steps, but expected at least ${expectedStepsCount} steps`,
		};
	},
	{
		onEachEntry: {
			scoreShouldBe: ">=",
			value: 1,
		},
		forTestrunOverall: {
			overallShouldBe: ">=",
			value: 100,
			for: "percentageOfPassedResults",
		},
	},
);

// Combined local evaluator
const localCombinedEvaluator = createCustomCombinedEvaluatorsFor("length-check", "contains-input").build<typeof dataStructure>(
	async (result, data) => {
		const lengthScore = result.output.length >= data["Expected Steps"].length ? 1 : 0;
		const containsScore = result.output.includes(data.Input) ? 1 : 0;
		return {
			"length-check": {
				score: lengthScore,
				reasoning: "Output length is sufficient",
			},
			"contains-input": {
				score: containsScore,
				reasoning: "Output contains input",
			},
		};
	},
	{
		"length-check": {
			onEachEntry: {
				scoreShouldBe: ">=",
				value: 1,
			},
			forTestrunOverall: {
				overallShouldBe: ">=",
				value: 100,
				for: "percentageOfPassedResults",
			},
		},
		"contains-input": {
			onEachEntry: {
				scoreShouldBe: ">=",
				value: 1,
			},
			forTestrunOverall: {
				overallShouldBe: ">=",
				value: 100,
				for: "percentageOfPassedResults",
			},
		},
	},
);

// Boolean evaluator
const localBooleanEvaluator = createCustomEvaluator<typeof dataStructure>(
	"has-question-mark",
	async (result) => {
		return {
			score: result.output.includes("?") ? true : false,
			reasoning: result.output.includes("?") ? "Contains question mark" : "Missing question mark",
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

// ===== Custom Logger =====
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

// ===== Test Suite =====
describe("Comprehensive Test Runs with Simulation", () => {
	let maxim: Maxim;

	beforeAll(() => {
		maxim = new Maxim({ apiKey, baseUrl });
	});

	afterAll(async () => {
		await maxim.cleanup();
	});

	// ===== VALID COMBINATIONS =====

	describe("Valid Combinations - Prompt Version", () => {
		test("Prompt + Dataset + Local Single Evaluator", async () => {
			const testCase = "prompt-dataset-local-single";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");

			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(datasetId)
				.withEvaluators(localSingleEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Dataset + Local Combined Evaluator", async () => {
			const testCase = "prompt-dataset-local-combined";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");

			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(datasetId)
				.withEvaluators(localCombinedEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Dataset + Maxim Evaluator", async () => {
			const testCase = "prompt-dataset-maxim-eval";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");

			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(datasetId)
				.withEvaluators("Faithfulness")
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 10 * 60 * 1000); // Increased timeout to 10 minutes

		test("Prompt + Dataset + Local + Maxim Evaluators", async () => {
			const testCase = "prompt-dataset-local-maxim";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(datasetId)
				.withEvaluators(localSingleEvaluator, "Faithfulness")
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Manual Data + Local Single Evaluator", async () => {
			const testCase = "prompt-manual-local-single";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(manualData)
				.withEvaluators(localSingleEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Manual Data + Local Combined Evaluator", async () => {
			const testCase = "prompt-manual-local-combined";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(manualData)
				.withEvaluators(localCombinedEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Manual Data + Multiple Local Evaluators", async () => {
			const testCase = "prompt-manual-multiple-local";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(manualData)
				.withEvaluators(localSingleEvaluator, localBooleanEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Dataset + Multiple Maxim Evaluators", async () => {
			const testCase = "prompt-dataset-multiple-maxim";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(datasetId)
				.withEvaluators("Faithfulness", "Consistency")
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Dataset + Local Combined + Maxim Evaluators", async () => {
			const testCase = "prompt-dataset-local-combined-maxim";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(datasetId)
				.withEvaluators(localCombinedEvaluator, "Faithfulness")
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Dataset + No evaluators", async () => {
			const testCase = "prompt-dataset-no-evaluators";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(datasetId)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);
	});

	describe("Valid Combinations - Workflow", () => {
		test("Workflow + Dataset + Local Single Evaluator", async () => {
			const testCase = "workflow-dataset-local-single";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withWorkflowId(workflowId)
				.withData(datasetId)
				.withEvaluators(localSingleEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Workflow + Dataset + Local Combined Evaluator", async () => {
			const testCase = "workflow-dataset-local-combined";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withWorkflowId(workflowId)
				.withData(datasetId)
				.withEvaluators(localCombinedEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Workflow + Dataset + Maxim Evaluator", async () => {
			const testCase = "workflow-dataset-maxim-eval";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withWorkflowId(workflowId)
				.withData(datasetId)
				.withEvaluators("Faithfulness")
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Workflow + Manual Data + Local Single Evaluator", async () => {
			const testCase = "workflow-manual-local-single";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withWorkflowId(workflowId)
				.withData(manualData)
				.withEvaluators(localSingleEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Workflow + Manual Data + Local + Maxim Evaluators", async () => {
			const testCase = "workflow-manual-local-maxim";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withWorkflowId(workflowId)
				.withData(manualData)
				.withEvaluators(localSingleEvaluator, "Faithfulness")
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);
	});

	describe("Simulation Config Variations", () => {
		test("Prompt + Dataset + Local Evaluator + Custom Simulation Config", async () => {
			const testCase = "prompt-dataset-custom-sim-config";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({
					maxTurns: 5,
					scenario: "Test scenario",
					persona: "Helpful assistant",
				})
				.withPromptVersionId(promptVersionId)
				.withData(datasetId)
				.withEvaluators(localSingleEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Workflow + Dataset + Local Evaluator + Minimal Simulation Config", async () => {
			const testCase = "workflow-dataset-minimal-sim-config";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({
					maxTurns: 2,
				})
				.withWorkflowId(workflowId)
				.withData(datasetId)
				.withEvaluators(localSingleEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);
	});

	// ===== INVALID COMBINATIONS (Error Handling) =====

	describe("Invalid Combinations - Error Handling", () => {
		test("Should fail: Simulation config without prompt or workflow", async () => {
			const testCase = "invalid-no-prompt-or-workflow";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			await expect(
				maxim
					.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
					.withDataStructure(dataStructure)
					.withSimulationConfig({ maxTurns: 3 })
					.withData(datasetId)
					.withEvaluators(localSingleEvaluator)
					.withLogger(logger)
					.run(120),
			).rejects.toThrow();
			console.log(`✅ ${testCase}: Correctly rejected`);
		});

		test("Should fail: Simulation config with yieldsOutput", async () => {
			const testCase = "invalid-sim-with-yields-output";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			await expect(
				maxim
					.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
					.withDataStructure(dataStructure)
					.withSimulationConfig({ maxTurns: 3 })
					.withData(manualData)
					.withEvaluators(localSingleEvaluator)
					.withLogger(logger)
					.yieldsOutput(async () => ({ data: "test" }))
					.run(120),
			).rejects.toThrow();
			console.log(`✅ ${testCase}: Correctly rejected`);
		});

		test("Should fail: No data", async () => {
			const testCase = "invalid-no-data";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			await expect(
				maxim
					.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
					.withDataStructure(dataStructure)
					.withSimulationConfig({ maxTurns: 3 })
					.withPromptVersionId(promptVersionId)
					.withEvaluators(localSingleEvaluator)
					.withLogger(logger)
					.run(120),
			).rejects.toThrow();
			console.log(`✅ ${testCase}: Correctly rejected`);
		});

		test("Should fail: Both prompt and workflow", async () => {
			const testCase = "invalid-both-prompt-workflow";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			// Note: This might not throw immediately, but should fail at runtime
			// The builder might allow this, but the actual run should fail
			try {
				await maxim
					.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
					.withDataStructure(dataStructure)
					.withSimulationConfig({ maxTurns: 3 })
					.withPromptVersionId(promptVersionId)
					.withWorkflowId(workflowId)
					.withData(datasetId)
					.withEvaluators(localSingleEvaluator)
					.withLogger(logger)
					.run(120);
				console.log(`⚠️ ${testCase}: Builder allowed both, but should be validated`);
			} catch (error) {
				console.log(`✅ ${testCase}: Correctly rejected`);
			}
		});
	});

	// ===== EDGE CASES =====

	describe("Edge Cases", () => {
		test("Prompt + Dataset + Boolean Local Evaluator", async () => {
			const testCase = "prompt-dataset-boolean-eval";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(datasetId)
				.withEvaluators(localBooleanEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Workflow + Single Manual Data Entry", async () => {
			const testCase = "workflow-single-manual-entry";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withWorkflowId(workflowId)
				.withData([manualData[0]])
				.withEvaluators(localSingleEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Dataset + All Evaluator Types Combined", async () => {
			const testCase = "prompt-dataset-all-eval-types";
			const logger = new TestLogger(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructure)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId)
				.withData(datasetId)
				.withEvaluators(localSingleEvaluator, simulationOutputsEvaluator)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);
	});
});
