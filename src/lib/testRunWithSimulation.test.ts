import "dotenv/config";
import fs from "node:fs";
import OpenAI from "openai";
import {
	createCustomCombinedEvaluatorsFor,
	createCustomEvaluator,
	createDataStructure,
	Data,
	DataStructure,
	LocalEvaluationResult,
	Maxim,
	TestRunLogger,
	TestRunConfig,
	YieldedOutput,
} from "../../index";
import type { SimulationConversationTurn, SimulationContext, CustomSimulatorConfig } from "../../index";

const config = JSON.parse(fs.readFileSync(`${process.cwd()}/testSimulationTestConfig.json`, "utf-8"));
const env = "prod";

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
	"Expected Steps": "EXPECTED_STEPS",
	Scenario: "SCENARIO",
	Persona: "VARIABLE"
});

// Data structure with Input (required for local-execution simulation)
const dataStructureWithInput = createDataStructure({
	Input: "INPUT",
	Scenario: "SCENARIO",
	"Expected Steps": "EXPECTED_STEPS",
	Context: "CONTEXT_TO_EVALUATE",
});

// Data structure with Persona for persona-from-dataset tests
const dataStructureWithoutPersona = createDataStructure({
	Input: "INPUT",
	"Expected Steps": "EXPECTED_STEPS",
	Scenario: "SCENARIO",
});

// Data structure with variables for custom simulator template tests
const dataStructureWithVariables = createDataStructure({
	Input: "INPUT",
	Scenario: "SCENARIO",
	Topic: "VARIABLE",
	"Expected Steps": "EXPECTED_STEPS",
});

// ===== Manual Test Data =====
const manualData: Data<typeof dataStructure>[] = [
	{
		"Expected Steps": `1.The "Pale Blue Dot" refers to an image of Earth taken by the Voyager 1 spacecraft from a distance of about 3.7 billion miles. In "Cosmos," Carl Sagan reflects on the image to illustrate the fragility and insignificance of Earth in the vastness of the universe, emphasizing the need for humility and unity among humanity.
		\n2. Yes. Sagan connects the "Pale Blue Dot" idea to humanity's tendency to think of itself as central or unique. By showing how tiny Earth is, he challenges that view and instead presents humans as part of a much larger cosmic story, made from the same matter as stars and governed by the same natural laws.`,
		Scenario: "Question about Pale Blue Dot",
		Persona: "You are an enthusiastic science student, you ask alot of questions and in the end of all of your questions u say H20. ",
	},
	{
		"Expected Steps": `1. Quantum entanglement is a phenomenon where two or more particles become connected in such a way that the state of one particle instantly affects the state of another, regardless of the distance between them.
		\n2. This connection happens instantaneously, faster than light, which challenges our classical understanding of physics.`,
		Scenario: "Science explanation request",
		Persona: "You are an enthusiastic science student, you ask alot of questions and in the end of all of your questions u say H20. "
	},
];

// Manual data with Input (for local-execution simulation tests)
const manualDataWithInput: Data<typeof dataStructureWithInput>[] = [
	{
		Input: "What is the Pale Blue Dot?",
		Scenario: "Question about Pale Blue Dot",
		"Expected Steps": "1. Answer the question.\n2. Provide context.",
		Context: "Context 1",
	},
];

// Manual data with variables for custom simulator template tests
const manualDataWithVariables: Data<typeof dataStructureWithVariables>[] = [
	{
		Input: "What is the Pale Blue Dot?",
		Scenario: "Question about the Pale Blue Dot photograph",
		Topic: "astronomy and space exploration",
		"Expected Steps": "1. Answer the question.\n2. Provide context.",
	},
];

// Custom simulator prompts
const CUSTOM_SIMULATOR_PROMPT_BASIC =
	"You are a curious user interested in science. " +
	"Ask one short follow-up question about the agent's last response. " +
	"Keep questions concise and relevant.";

const CUSTOM_SIMULATOR_PROMPT_WITH_VARS =
	"You are a curious user interested in {{ Topic }}. " +
	"The scenario is: {{ Scenario }}. " +
	"Ask one short follow-up question about the agent's last response, " +
	"staying on topic.";

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
		const containsScore = result.output.includes(result.simulationOutputs?.join("\n") ?? "") ? 1 : 0;
		console.log("result.simulationOutputs", result.simulationOutputs);
		console.log("result.simulationOutputs.join(\n)", result.simulationOutputs?.join("\n"));
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

// Combined local evaluator for dataset-compatible data structure
const localCombinedEvaluatorForDataset = createCustomCombinedEvaluatorsFor("length-check", "contains-input").build<typeof dataStructureWithoutPersona>(
	async (result, data) => {
		const lengthScore = result.output && data["Expected Steps"] && result.output.length >= data["Expected Steps"].length ? 1 : 0;
		const containsScore = result.output.includes(result.simulationOutputs?.join("\n") ?? "") ? 1 : 0;
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
			onEachEntry: { scoreShouldBe: ">=", value: 1 },
			forTestrunOverall: { overallShouldBe: ">=", value: 100, for: "percentageOfPassedResults" },
		},
		"contains-input": {
			onEachEntry: { scoreShouldBe: ">=", value: 1 },
			forTestrunOverall: { overallShouldBe: ">=", value: 100, for: "percentageOfPassedResults" },
		},
	},
);

// Local evaluator for data structure with Persona (same logic, different type)
const localSingleEvaluatorWithPersona = createCustomEvaluator<typeof dataStructureWithoutPersona>(
	"output-length-validator",
	async (result, data) => {
		const lengthScore = result.output && data["Expected Steps"] && result.output.length >= data["Expected Steps"].length ? 1 : 0;
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

// Local evaluator for dataStructureWithInput
const localEvalWithInput = createCustomEvaluator<typeof dataStructureWithInput>(
	"output-length-validator",
	async (result, data) => {
		const lengthScore = result.output.length >= (data["Expected Steps"]?.length ?? 0) ? 1 : 0;
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

// ===== yieldsOutput functions for local-execution simulation tests =====

/**
 * Basic yieldsOutput - input/output only (matches Python's yields_fn).
 */
const yieldsOutputBasic = async (
	_data: Data<typeof dataStructureWithInput>,
	simCtx?: SimulationContext,
): Promise<YieldedOutput> => {
	if (!simCtx) return { data: "Initial response" };
	const inputText = (simCtx.currentUserInput?.["input"] as string) ?? "";
	return { data: `Responding to: ${inputText}` };
};

/**
 * yieldsOutput with conversation history (matches Python's yields_fn_with_context).
 */
const yieldsOutputWithContext = async (
	_data: Data<typeof dataStructureWithInput>,
	simCtx?: SimulationContext,
): Promise<YieldedOutput> => {
	if (!simCtx) return { data: "Initial response" };

	const userInput = (simCtx.currentUserInput?.["input"] as string) ?? "";

	// Build conversation history for your LLM call
	const messages: { role: string; content: string }[] = [];
	for (const turn of simCtx.conversationHistory) {
		const userMsg = (turn.request?.["input"] as string) ?? "";
		const assistantMsg = (turn.response?.["output"] as string) ?? (turn.response?.["data"] as string) ?? "";
		if (userMsg) messages.push({ role: "user", content: userMsg });
		if (assistantMsg) messages.push({ role: "assistant", content: assistantMsg });
	}
	messages.push({ role: "user", content: userInput });

	return { data: `Turn ${simCtx.turnNumber}: Responding to '${userInput}'` };
};

/**
 * yieldsOutput that returns STOP on turn 2 for stopTrigger tests (matches Python's yields_fn_stop).
 */
const yieldsOutputForStop = async (
	_data: Data<typeof dataStructureWithInput>,
	simCtx?: SimulationContext,
): Promise<YieldedOutput> => {
	if (!simCtx) return { data: "Initial" };
	if (simCtx.turnNumber >= 2) return { data: "STOP" };
	return { data: `Turn ${simCtx.turnNumber} response` };
};

/**
 * yieldsOutput with LLM call for local-execution tests (matches Python's yields_fn_with_llm).
 */
const yieldsOutputWithLlm = async (
	_data: Data<typeof dataStructureWithInput>,
	simCtx?: SimulationContext,
): Promise<YieldedOutput> => {
	if (!simCtx) return { data: "Initial response" };

	const userInput = (simCtx.currentUserInput?.["input"] as string) ?? "";

	const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
	for (const turn of simCtx.conversationHistory) {
		const userMsg = (turn.request?.["input"] as string) ?? "";
		const assistantMsg = (turn.response?.["output"] as string) ?? (turn.response?.["data"] as string) ?? "";
		if (userMsg) messages.push({ role: "user", content: userMsg });
		if (assistantMsg) messages.push({ role: "assistant", content: assistantMsg });
	}
	messages.push({ role: "user", content: userInput });

	const openaiKey = process.env["OPENAI_API_KEY"];
	if (openaiKey) {
		try {
			const openai = new OpenAI({ apiKey: openaiKey });
			const resp = await openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages,
				max_tokens: 150,
			});
			return { data: resp.choices[0]?.message?.content ?? "" };
		} catch (e) {
			return { data: `[LLM fallback] Turn ${simCtx.turnNumber}: '${userInput}' - error: ${e}` };
		}
	}

	// Fallback when no LLM
	return { data: `Turn ${simCtx.turnNumber}: Responding to '${userInput}' (mock LLM)` };
};

// ===== Shared yieldsOutput callback for simulation tests =====
const defaultYieldsOutput = async (
	_data: Data<typeof dataStructure>,
	simulationContext?: SimulationContext,
) => {
	// Log message history for debugging - verify conversationHistory is passed to yieldsOutput
	if (simulationContext) {
		console.log(`[yieldsOutput] Turn ${simulationContext.turnNumber} - conversationHistory length: ${simulationContext.conversationHistory?.length ?? 0}`);
		console.log(`[yieldsOutput] totalCost: ${simulationContext.totalCost}, totalTokens: ${simulationContext.totalTokens}`);
		console.log(
			`[yieldsOutput] conversationHistory:`,
			JSON.stringify(
				simulationContext.conversationHistory?.map((t) => ({
					turn: t.turn,
					request: t.request,
					responseOutput: t.response?.["output"] ?? t.response,
				})),
				null,
				2,
			),
		);
		console.log(`[yieldsOutput] currentUserInput:`, JSON.stringify(simulationContext.currentUserInput, null, 2));
	}

	const userMsg = simulationContext
		? (simulationContext.currentUserInput?.["input"] as string) ??
			(simulationContext.currentUserInput?.["message"] as string) ??
			JSON.stringify(simulationContext.currentUserInput)
		: "";
	const response = simulationContext
		? `Turn ${simulationContext.turnNumber}: Responding to "${userMsg}"`
		: "Initial response";
	return { data: response };
};

/**
 * YieldsOutput that makes an actual LLM call using OpenAI.
 * Converts conversationHistory to chat messages and calls gpt-4o-mini.
 * Requires OPENAI_API_KEY in environment.
 */
const llmYieldsOutput = async (
	_data: Data<typeof dataStructure>,
	simulationContext?: SimulationContext,
) => {
	const openaiKey = process.env["OPENAI_API_KEY"];
	if (!openaiKey) {
		throw new Error("OPENAI_API_KEY is required for llmYieldsOutput. Set it in your .env file.");
	}

	// Log message history (same as defaultYieldsOutput)
	if (simulationContext) {
		console.log(`[llmYieldsOutput] Turn ${simulationContext.turnNumber} - conversationHistory length: ${simulationContext.conversationHistory?.length ?? 0}`);
		console.log(
			`[llmYieldsOutput] conversationHistory:`,
			JSON.stringify(
				simulationContext.conversationHistory?.map((t) => ({
					turn: t.turn,
					request: t.request,
					responseOutput: t.response?.["output"] ?? t.response,
				})),
				null,
				2,
			),
		);
		console.log(`[llmYieldsOutput] currentUserInput:`, JSON.stringify(simulationContext.currentUserInput, null, 2));
	}

	// Build messages from conversationHistory + currentUserInput
	const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
		{
			role: "system",
			content:
				"You are an enthusiastic science student. You ask a lot of questions and at the end of all your questions you say H20. Keep responses concise.",
		},
	];

	// Add conversation history (user/assistant turns)
	if (simulationContext?.conversationHistory?.length) {
		for (const turn of simulationContext.conversationHistory) {
			const userContent = (turn.request?.["input"] as string) ?? (turn.request?.["message"] as string) ?? JSON.stringify(turn.request);
			if (userContent) {
				messages.push({ role: "user", content: userContent });
			}
			const assistantContent = (turn.response?.["output"] as string) ?? (typeof turn.response === "string" ? turn.response : JSON.stringify(turn.response));
			if (assistantContent) {
				messages.push({ role: "assistant", content: assistantContent });
			}
		}
	}

	// Add current user input
	const currentUserContent = simulationContext
		? (simulationContext.currentUserInput?.["input"] as string) ??
			(simulationContext.currentUserInput?.["message"] as string) ??
			JSON.stringify(simulationContext.currentUserInput)
		: "";
	if (currentUserContent) {
		messages.push({ role: "user", content: currentUserContent });
	}

	console.log(`[llmYieldsOutput] Sending ${messages.length} messages to LLM`);

	const openai = new OpenAI({ apiKey: openaiKey });
	const completion = await openai.chat.completions.create({
		model: "gpt-4o-mini",
		messages,
		max_tokens: 256,
		temperature: 0.7,
	});

	const responseText = completion.choices[0]?.message?.content ?? "";
	console.log(`[llmYieldsOutput] LLM response (turn ${simulationContext?.turnNumber ?? 0}):`, responseText.slice(0, 100) + (responseText.length > 100 ? "..." : ""));

	return {
		data: responseText,
		meta: completion.usage
			? {
					usage: {
						promptTokens: completion.usage.prompt_tokens,
						completionTokens: completion.usage.completion_tokens,
						totalTokens: completion.usage.total_tokens ?? 0,
					},
				}
			: undefined,
	};
};

const defaultYieldsOutputWithPersona = async (
	_data: Data<typeof dataStructureWithoutPersona>,
	simulationContext?: SimulationContext,
) => {
	// Log message history for debugging
	if (simulationContext) {
		console.log(`[yieldsOutputWithPersona] Turn ${simulationContext.turnNumber} - conversationHistory length: ${simulationContext.conversationHistory?.length ?? 0}`);
		console.log(`[yieldsOutputWithPersona] currentUserInput:`, JSON.stringify(simulationContext.currentUserInput, null, 2));
	}

	const userMsg = simulationContext
		? (simulationContext.currentUserInput?.["input"] as string) ??
			(simulationContext.currentUserInput?.["message"] as string) ??
			JSON.stringify(simulationContext.currentUserInput)
		: "";
	const response = simulationContext
		? `Turn ${simulationContext.turnNumber}: Responding to "${userMsg}"`
		: "Initial response";
	return { data: response };
};

// ===== Custom Logger =====
class TestLogger<T extends DataStructure = typeof dataStructure> implements TestRunLogger<T> {
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
			datasetEntry: Data<T>;
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
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");

			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
				.withData(datasetId)
				.withEvaluators(localSingleEvaluatorWithPersona)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Dataset + Local Combined Evaluator", async () => {
			const testCase = "prompt-dataset-local-combined";
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");

			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
				.withData(datasetId)
				.withEvaluators(localCombinedEvaluatorForDataset)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Dataset + Maxim Evaluator", async () => {
			const testCase = "prompt-dataset-maxim-eval";
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");

			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
				.withData(datasetId)
				.withEvaluators("Bias")
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 10 * 60 * 1000); // Increased timeout to 10 minutes

		test("Prompt + Dataset + Local + Maxim Evaluators", async () => {
			const testCase = "prompt-dataset-local-maxim";
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
				.withData(datasetId)
				.withEvaluators(localSingleEvaluatorWithPersona, "Bias")
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
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
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
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
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
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
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
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
				.withData(datasetId)
				.withEvaluators("Bias", "Consistency")
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Dataset + Local Combined + Maxim Evaluators", async () => {
			const testCase = "prompt-dataset-local-combined-maxim";
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
				.withData(datasetId)
				.withEvaluators(localCombinedEvaluatorForDataset, "Bias")
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Prompt + Dataset + No evaluators", async () => {
			const testCase = "prompt-dataset-no-evaluators";
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({ maxTurns: 3 })
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
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
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({ maxTurns: 3 })
				.withWorkflowId(workflowId, "[SAMPLE] Cosmos context source")
				.withData(datasetId)
				.withEvaluators(localSingleEvaluatorWithPersona)
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		test("Workflow + Dataset + Maxim Evaluator", async () => {
			const testCase = "workflow-dataset-maxim-eval";
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({ maxTurns: 3 })
				.withWorkflowId(workflowId, "[SAMPLE] Cosmos context source")
				.withData(datasetId)
				.withEvaluators("Bias")
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
				.withWorkflowId(workflowId, "[SAMPLE] Cosmos context source")
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
				.withWorkflowId(workflowId, "[SAMPLE] Cosmos context source")
				.withData(manualData)
				.withEvaluators(localSingleEvaluator, "Bias")
				.withLogger(logger)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult).toBeDefined();
			expect(result.testRunResult.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);
	});

	describe("Simulation Config Variations", () => {
		test("Prompt + Dataset + Local Evaluator + Simulation Config", async () => {
			const testCase = "prompt-dataset-minimal-sim-config";
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({
					maxTurns: 5,
					scenario: "Test scenario",
				})
				.withPromptVersionId(promptVersionId, "[SAMPLE] Cosmos context source")
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
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			logger.info("Starting test, Valid Combinations - Prompt Version");
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({
					maxTurns: 2,
				})
				.withWorkflowId(workflowId, "[SAMPLE] Cosmos context source")
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
	
	// ===== LOCAL-EXECUTION SIMULATION TESTS (matching Python test_examples_simulation.py) =====
	// These tests use the new unified local-execution endpoint with yieldsOutput.
	// They do NOT require promptVersionId or workflowId.

	describe("Local-Execution Simulation - Basic (yieldsOutput)", () => {
		// Matches Python: test_sim_persona_string_manual_data
		test("Persona as string + manual data + local evaluator", async () => {
			const testCase = "sim-local-persona-string-manual";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({
					maxTurns: 4,
					persona: "You are a curious science student who asks short follow-up questions.",
				})
				.withData(manualDataWithInput)
				.withEvaluators(localEvalWithInput)
				.withLogger(logger)
				.yieldsOutput(yieldsOutputBasic)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

	// 	// Matches Python: test_sim_with_scenario_manual_data
		test("Scenario from manual data + local evaluator", async () => {
			const testCase = "sim-local-scenario-manual";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({ maxTurns: 4 })
				.withData(manualDataWithInput)
				.withEvaluators(localEvalWithInput)
				.withLogger(logger)
				.yieldsOutput(yieldsOutputBasic)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

	// 	// Matches Python: test_sim_no_evaluators_manual_data
		test("No evaluators + manual data", async () => {
			const testCase = "sim-local-no-evals-manual";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({ maxTurns: 3 })
				.withData(manualDataWithInput)
				.withLogger(logger)
				.yieldsOutput(yieldsOutputBasic)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

	// 	// Matches Python: test_sim_yields_with_context_manual_data
		test("yields_output with conversation context", async () => {
			const testCase = "sim-local-yields-context";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({ maxTurns: 4 })
				.withData(manualDataWithInput)
				.withEvaluators(localEvalWithInput)
				.withLogger(logger)
				.yieldsOutput(yieldsOutputWithContext)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

	// 	// Matches Python: test_sim_stop_trigger_manual_data
		test("stopTrigger ends simulation early", async () => {
			const testCase = "sim-local-stop-trigger";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({
					maxTurns: 10,
					stopTrigger: { field: "data", value: "STOP" },
				})
				.withData(manualDataWithInput)
				.withEvaluators(localEvalWithInput)
				.withLogger(logger)
				.yieldsOutput(yieldsOutputForStop)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		// Matches Python: test_sim_additional_instructions_manual_data
		test("additionalInstructions in simulation config", async () => {
			const testCase = "sim-local-additional-instructions";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({
					maxTurns: 4,
					additionalInstructions: "Keep questions brief and focused.",
				})
				.withData(manualDataWithInput)
				.withEvaluators(localEvalWithInput)
				.withLogger(logger)
				.yieldsOutput(yieldsOutputBasic)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		// Matches Python: test_sim_yields_with_llm_manual_data
		test("yields_output with LLM call (when OPENAI_API_KEY set)", async () => {
			const testCase = "sim-local-yields-llm";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({ maxTurns: 3 })
				.withData(manualDataWithInput)
				.withEvaluators(localEvalWithInput)
				.withLogger(logger)
				.yieldsOutput(yieldsOutputWithLlm)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		// Matches Python: test_sim_with_dataset_id_local_eval
		test("Dataset ID + local evaluator", async () => {
			const testCase = "sim-local-dataset-id";
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({ maxTurns: 3 })
				.withData(datasetId)
				.withEvaluators(localEvalWithInput)
				.withLogger(logger)
				.yieldsOutput(defaultYieldsOutputWithPersona)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		// Matches Python: test_sim_local_and_platform_evals_manual_data
		test("Local + platform evaluators", async () => {
			const testCase = "sim-local-and-platform-evals";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({ maxTurns: 4 })
				.withData(manualDataWithInput)
				.withEvaluators(localEvalWithInput, "Bias")
				.withLogger(logger)
				.yieldsOutput(yieldsOutputBasic)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 5 * 60 * 1000);

		// Matches Python: test_sim_simulation_outputs_evaluator_manual_data
		test("Simulation outputs evaluator", async () => {
			const testCase = "sim-local-outputs-eval";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const simOutputsEval = createCustomEvaluator<typeof dataStructureWithInput>(
				"simulation-steps-validator",
				async (result, data) => {
					if (!result.simulationOutputs || result.simulationOutputs.length === 0) {
						return { score: 0, reasoning: "No simulation outputs available" };
					}
					const expectedStepsCount = (data["Expected Steps"] ?? "").split("\n").filter((l) => l.trim()).length;
					const actualStepsCount = result.simulationOutputs.length;
					return {
						score: actualStepsCount >= expectedStepsCount ? 1 : 0,
						reasoning: `Simulation produced ${actualStepsCount} steps, expected ${expectedStepsCount}`,
					};
				},
				{
					onEachEntry: { scoreShouldBe: ">=", value: 1 },
					forTestrunOverall: { overallShouldBe: ">=", value: 100, for: "percentageOfPassedResults" },
				},
			);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({ maxTurns: 4 })
				.withData(manualDataWithInput)
				.withEvaluators(localEvalWithInput, simOutputsEval)
				.withLogger(logger)
				.yieldsOutput(yieldsOutputBasic)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);
	});

	describe("Local-Execution Simulation - Custom Simulator", () => {
		// Matches Python: test_custom_sim_manual_data_with_local_evals
		test("Custom simulator + manual data + local evaluators", async () => {
			const testCase = "custom-sim-manual-local-evals";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({
					maxTurns: 3,
					customSimulator: {
						simulatorPrompt: CUSTOM_SIMULATOR_PROMPT_BASIC,
						model: "gpt-4o-mini",
						provider: "openai",
					},
				})
				.withData(manualDataWithInput)
				.withEvaluators(localEvalWithInput)
				.withLogger(logger)
				.yieldsOutput(yieldsOutputWithLlm)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		// Matches Python: test_custom_sim_manual_data_no_local_evals
		test("Custom simulator + manual data + platform evaluator", async () => {
			const testCase = "custom-sim-manual-platform-eval";
			const logger = new TestLogger<typeof dataStructureWithInput>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithInput)
				.withSimulationConfig({
					maxTurns: 3,
					customSimulator: {
						simulatorPrompt: CUSTOM_SIMULATOR_PROMPT_BASIC,
						model: "gpt-4o-mini",
						provider: "openai",
					},
				})
				.withData(manualDataWithInput)
				.withEvaluators("Faithfulness")
				.withLogger(logger)
				.yieldsOutput(yieldsOutputWithLlm)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 5 * 60 * 1000);

		// Matches Python: test_custom_sim_dataset_id_with_local_evals
		test("Custom simulator + dataset ID + platform evaluator", async () => {
			const testCase = "custom-sim-dataset-platform-eval";
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({
					maxTurns: 3,
					customSimulator: {
						simulatorPrompt: CUSTOM_SIMULATOR_PROMPT_BASIC,
						model: "gpt-4o-mini",
						provider: "openai",
					},
				})
				.withData(datasetId)
				.withEvaluators("Faithfulness")
				.withLogger(logger)
				.yieldsOutput(defaultYieldsOutputWithPersona)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 5 * 60 * 1000);

		// Matches Python: test_custom_sim_dataset_id_no_local_evals
		test("Custom simulator + dataset ID + no evaluators", async () => {
			const testCase = "custom-sim-dataset-no-evals";
			const logger = new TestLogger<typeof dataStructureWithoutPersona>(testCase);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithoutPersona)
				.withSimulationConfig({
					maxTurns: 3,
					customSimulator: {
						simulatorPrompt: CUSTOM_SIMULATOR_PROMPT_BASIC,
						model: "gpt-4o-mini",
						provider: "openai",
					},
				})
				.withData(datasetId)
				.withLogger(logger)
				.yieldsOutput(defaultYieldsOutputWithPersona)
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);

		// Custom simulator with template variables
		test("Custom simulator + template variables in prompt", async () => {
			const testCase = "custom-sim-template-vars";
			const logger = new TestLogger<typeof dataStructureWithVariables>(testCase);
			const localEval = createCustomEvaluator<typeof dataStructureWithVariables>(
				"output-length-validator",
				async (result) => ({
					score: result.output.length > 0 ? 1 : 0,
					reasoning: result.output.length > 0 ? "Has output" : "Empty output",
				}),
				{
					onEachEntry: { scoreShouldBe: ">=", value: 1 },
					forTestrunOverall: { overallShouldBe: ">=", value: 100, for: "percentageOfPassedResults" },
				},
			);
			const result = await maxim
				.createTestRun(`SDK Test: ${testCase} - ${Date.now()}`, workspaceId)
				.withDataStructure(dataStructureWithVariables)
				.withSimulationConfig({
					maxTurns: 3,
					customSimulator: {
						simulatorPrompt: CUSTOM_SIMULATOR_PROMPT_WITH_VARS,
						model: "gpt-4o-mini",
						provider: "openai",
					},
				})
				.withData(manualDataWithVariables)
				.withEvaluators(localEval)
				.withLogger(logger)
				.yieldsOutput(async (_data, simCtx) => {
					if (!simCtx) return { data: "Initial response" };
					const input = (simCtx.currentUserInput?.["input"] as string) ?? "";
					return { data: `Turn ${simCtx.turnNumber}: Responding to '${input}'` };
				})
				.run(120);

			expect(result).toBeDefined();
			expect(result.testRunResult?.link).toBeDefined();
			console.log(`✅ ${testCase}: ${result.testRunResult.link}`);
		}, 3 * 60 * 1000);
	});
});
