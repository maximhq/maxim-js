process.env["NODE_ENV"] = "development";

import { addTraceProcessor, Agent, run, withTrace, tool, withGenerationSpan, setOpenAIAPI } from "@openai/agents";
import "dotenv/config";
import { z } from "zod";
import { Maxim } from "../../../../index";
import { MaximOpenAIAgentsProcessor } from "../../../../openai-agents";

const MAX_TEST_TIMEOUT_MS = 60_000;

describe("OpenAI Agents SDK integration (Maxim)", () => {
	let baseUrl = process.env["MAXIM_BASE_URL"];
	const apiKey = process.env["MAXIM_API_KEY"]!;
	const repoId = process.env["MAXIM_LOG_REPO_ID"]!;
	const openaiKey = process.env["OPENAI_API_KEY"]!;

	let maxim: Maxim;

	beforeAll(async () => {
		await new Promise((resolve) => setTimeout(resolve, 2000));
		if (!apiKey || !openaiKey) {
			throw new Error("MAXIM_API_KEY and OPENAI_API_KEY environment variables are required");
		}
		maxim = new Maxim({ baseUrl, apiKey });
	});

	afterAll(async () => {
		await maxim.cleanup();
	});

	test(
		"attaches tracing and runs a simple agent (no tools, no network)",
		async () => {
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			const agent = Agent.create({ name: "Echo", instructions: "Greet briefly." });

			addTraceProcessor(new MaximOpenAIAgentsProcessor(logger));

			const result = await run(agent, "Say hello");
			expect(typeof result.finalOutput).toBe("string");
		},
		MAX_TEST_TIMEOUT_MS,
	);

	test(
		"single agent with multiple mocked tools (all local, no network)",
		async () => {
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			addTraceProcessor(new MaximOpenAIAgentsProcessor(logger));

			const mock_search = tool({
				name: "mock_search",
				description: "Return a static snippet for a given query",
				parameters: z.object({ query: z.string() }),
				execute: async ({ query }) => {
					return `RESULT[${query}] :: The quick brown fox.`;
				},
			});

			const mock_summarize = tool({
				name: "mock_summarize",
				description: "Return a deterministic short summary of the input",
				parameters: z.object({ text: z.string() }),
				execute: async ({ text }) => {
					const trimmed = text.slice(0, 24);
					return `SUM:${trimmed}`;
				},
			});

			const mock_format = tool({
				name: "mock_format",
				description: "Wrap text in brackets",
				parameters: z.object({ text: z.string() }),
				execute: async ({ text }) => {
					return `[${text}]`;
				},
			});

			const agent = Agent.create({
				name: "MockToolsAgent",
				instructions: "When asked a question, first call mock_search, then mock_summarize, then mock_format to present the final answer.",
				tools: [mock_search, mock_summarize, mock_format],
			});

			const result = await run(agent, "Explain foxes briefly");
			expect(typeof result.finalOutput).toBe("string");
		},
		MAX_TEST_TIMEOUT_MS,
	);

	test(
		"router triage handoff (history vs math) with mocked tools",
		async () => {
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			addTraceProcessor(new MaximOpenAIAgentsProcessor(logger));

			const history_fun_fact = tool({
				name: "history_fun_fact",
				description: "Return a constant history fact",
				parameters: z.object({}),
				execute: async () => {
					return "Sharks are older than trees.";
				},
			});

			const adder = tool({
				name: "adder",
				description: "Add two numbers deterministically",
				parameters: z.object({ a: z.number(), b: z.number() }),
				execute: async ({ a, b }) => {
					return String(a + b);
				},
			});

			const historyTutorAgent = Agent.create({
				name: "History Tutor",
				instructions: "Answer history questions succinctly. Use history_fun_fact when asked for a fun fact.",
				tools: [history_fun_fact],
			});

			const mathTutorAgent = Agent.create({
				name: "Math Tutor",
				instructions: "Help with basic arithmetic using the adder tool.",
				tools: [adder],
			});

			const triageAgent = Agent.create({
				name: "Triage Agent",
				instructions:
					"If the user asks history-oriented questions (who/when/where in the past), hand off to History Tutor. If the user asks to add numbers, hand off to Math Tutor.",
				handoffs: [historyTutorAgent, mathTutorAgent],
			});

			const hist = await run(triageAgent, "Give me a history fun fact about ancient animals.");
			expect(typeof hist.finalOutput).toBe("string");

			const math = await run(triageAgent, "Please add 2 and 5");
			expect(typeof math.finalOutput).toBe("string");
		},
		MAX_TEST_TIMEOUT_MS,
	);

	test(
		"multi-hop pipeline under a single trace with mocked tools",
		async () => {
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			addTraceProcessor(new MaximOpenAIAgentsProcessor(logger));

			const mock_search = tool({
				name: "mock_search",
				description: "Return a static snippet for a given query",
				parameters: z.object({ query: z.string() }),
				execute: async ({ query }) => `RESULT[${query}] :: Earth orbits Sun.`,
			});

			const adder = tool({
				name: "adder",
				description: "Add two numbers deterministically",
				parameters: z.object({ a: z.number(), b: z.number() }),
				execute: async ({ a, b }) => String(a + b),
			});

			const mock_format = tool({
				name: "mock_format",
				description: "Wrap text in brackets",
				parameters: z.object({ text: z.string() }),
				execute: async ({ text }) => `[${text}]`,
			});

			const researcher = Agent.create({
				name: "Researcher",
				instructions: "Use mock_search to gather a short snippet.",
				tools: [mock_search],
			});

			const calculator = Agent.create({
				name: "Calculator",
				instructions: "Use adder to add provided numbers.",
				tools: [adder],
			});

			const writer = Agent.create({
				name: "Writer",
				instructions: "Use mock_format to present the final answer.",
				tools: [mock_format],
			});

			const { research, calc, write } = await withTrace("Research-Calc-Write pipeline", async () => {
				const research = await run(researcher, "Find a fact about the solar system.");
				const calc = await run(calculator, "Add 7 and 11 deterministically.");
				const write = await run(writer, `Format this combined note: ${research.finalOutput} (+ ${calc.finalOutput})`);
				return { research, calc, write };
			});

			expect(typeof research.finalOutput).toBe("string");
			expect(typeof calc.finalOutput).toBe("string");
			expect(typeof write.finalOutput).toBe("string");
		},
		MAX_TEST_TIMEOUT_MS,
	);

	test(
		"nested sub-traces with manual orchestration across agents (mocked tools)",
		async () => {
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			addTraceProcessor(new MaximOpenAIAgentsProcessor(logger));

			const mock_summarize = tool({
				name: "mock_summarize",
				description: "Return a deterministic short summary of the input",
				parameters: z.object({ text: z.string() }),
				execute: async ({ text }) => `SUM:${text.slice(0, 18)}`,
			});

			const mock_format = tool({
				name: "mock_format",
				description: "Wrap text in brackets",
				parameters: z.object({ text: z.string() }),
				execute: async ({ text }) => `[${text}]`,
			});

			const summarizer = Agent.create({
				name: "Summarizer",
				instructions: "Use mock_summarize to summarize the provided text.",
				tools: [mock_summarize],
			});

			const formatter = Agent.create({
				name: "Formatter",
				instructions: "Use mock_format to format input.",
				tools: [mock_format],
			});

			const final = await withTrace("Coordinator Pipeline", async () => {
				const s = await withTrace("Summarization", async () => await run(summarizer, "Summarize this: Long text about a topic."));
				const f = await withTrace("Formatting", async () => await run(formatter, `Format: ${s.finalOutput}`));
				return f;
			});

			expect(typeof final.finalOutput).toBe("string");
		},
		MAX_TEST_TIMEOUT_MS,
	);

	test(
		"agent with mocked tools (no external services) and nested control flow",
		async () => {
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			addTraceProcessor(new MaximOpenAIAgentsProcessor(logger));

			// Real model calls grouped under a single trace (no external tools)
			const agent = Agent.create({ name: "Chainer", instructions: "Answer succinctly." });
			const { r1, r2 } = await withTrace("Chained workflow", async () => {
				const r1 = await run(agent, "Return the word alpha");
				const r2 = await run(agent, "Return the word beta");
				return { r1, r2 };
			});
			expect(typeof r1.finalOutput).toBe("string");
			expect(typeof r2.finalOutput).toBe("string");
		},
		MAX_TEST_TIMEOUT_MS,
	);

	test(
		"multi-agent orchestration (router -> specialist) with mocked tools",
		async () => {
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			addTraceProcessor(new MaximOpenAIAgentsProcessor(logger));

			// Two cooperating agents, orchestrated without external services
			const summarizer = Agent.create({ name: "summarizer", instructions: "Summarize in 3 words." });
			const formatter = Agent.create({ name: "formatter", instructions: "Wrap the text in brackets." });
			const s = await run(summarizer, "Summarize: The earth orbits the sun.");
			const f = await run(formatter, `Format this: ${s.finalOutput}`);
			expect(typeof f.finalOutput).toBe("string");
		},
		MAX_TEST_TIMEOUT_MS,
	);

	test(
		"agent with generation span",
		async () => {
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			addTraceProcessor(new MaximOpenAIAgentsProcessor(logger));

			// Use Chat Completions instead of Responses (Responses is the default)
			setOpenAIAPI("chat_completions");

			const agent = new Agent({
				name: "Assistant",
				instructions: "Be concise.",
				model: "gpt-4o-mini",
			});

			await withTrace("My workflow", async () => {
				// include inputs/outputs in spans (optional but useful)
				const result = await run(agent, "Summarize the Three-Body Problem in one sentence.");
				expect(typeof result.finalOutput).toBe("string");
			});
		},
		MAX_TEST_TIMEOUT_MS,
	);
});
