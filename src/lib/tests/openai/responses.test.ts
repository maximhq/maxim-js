import OpenAI from "openai";
import { config } from "dotenv";
import { v4 as uuid } from "uuid";
import { Maxim } from "../../../../index";
import { MaximOpenAIClient } from "../../../../openai-sdk";

config();

let maxim: Maxim;

// local config
const openAIKey = process.env["OPENAI_API_KEY"];
const apiKey = process.env["MAXIM_API_KEY"];
const baseUrl = process.env["MAXIM_BASE_URL"];
const repoId = process.env["MAXIM_LOG_REPO_ID"];

describe("OpenAI Responses API Integration Tests", () => {
	beforeAll(async () => {
		if (!baseUrl || !apiKey || !repoId) {
			throw new Error("MAXIM_BASE_URL, MAXIM_API_KEY & MAXIM_LOG_REPO_ID environment variables are required");
		}
		maxim = new Maxim({
			baseUrl: baseUrl,
			apiKey: apiKey,
		});
	});

	afterAll(async () => {
		await maxim.cleanup();
	});

	describe("MaximOpenAIClient Responses", () => {
		it("should trace non-streaming response with simple string input", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const response = await client.responses.create({
				model: "gpt-4o-mini",
				input: "What is 2 + 2? Answer with just the number.",
			});

			console.log("Non-streaming response output_text:", response.output_text);
			expect(response).toBeDefined();
			expect(response.id).toBeDefined();
			expect(response.output_text).toBeDefined();
			expect(response.output_text.length).toBeGreaterThan(0);

			await logger.cleanup();
		}, 30000);

		it("should trace non-streaming response with message array input", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const response = await client.responses.create({
				model: "gpt-4o-mini",
				input: [
					{ role: "system", content: "You are a helpful assistant." },
					{ role: "user", content: "What is the capital of France? Answer with just the city name." },
				],
			});

			console.log("Response with message array:", response.output_text);
			expect(response).toBeDefined();
			expect(response.output_text).toBeDefined();
			expect(response.output_text.toLowerCase()).toContain("paris");

			await logger.cleanup();
		}, 30000);

		it("should trace streaming response", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const stream = client.responses.stream({
				model: "gpt-4o-mini",
				input: "Who is Optimus Prime?",
				stream: true,
			});

			let eventCount = 0;
			let textDeltaContent = "";

			for await (const event of stream) {
				eventCount++;
				// Capture text delta events
				if (event.type === "response.output_text.delta") {
					textDeltaContent += (event as any).delta || "";
				}
			}

			console.log("Streaming response - events received:", eventCount);
			console.log("Streaming response - accumulated text:", textDeltaContent);
			expect(eventCount).toBeGreaterThan(0);
			expect(textDeltaContent.length).toBeGreaterThan(0);

			// Give time for logs to be queued after stream finalization
			await new Promise((resolve) => setTimeout(resolve, 100));
			await logger.flush();
			await logger.cleanup();
		}, 30000);

		it("should trace response with custom trace ID", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const trace = logger.trace({ id: uuid() });
			const generationName = "test-responses-generation";

			const response = await client.responses.create(
				{
					model: "gpt-4o-mini",
					input: "Say hello in Spanish.",
				},
				{
					headers: {
						"maxim-trace-id": trace.id,
						"maxim-generation-name": generationName,
					},
				},
			);

			console.log("Response with custom trace ID:", response.output_text);
			expect(response).toBeDefined();
			expect(response.output_text).toBeDefined();

			trace.end();
			await logger.cleanup();
		}, 30000);

		it("should trace streaming response with custom trace ID", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const trace = logger.trace({ id: uuid() });
			const generationName = "test-streaming-responses-generation";

			const stream = client.responses.stream(
				{
					model: "gpt-4o-mini",
					input: "What is the capital of Norway?",
					stream: true,
				},
				{
					headers: {
						"maxim-trace-id": trace.id,
						"maxim-generation-name": generationName,
					},
				},
			);

			let textContent = "";
			for await (const event of stream) {
				if (event.type === "response.output_text.delta") {
					textContent += (event as any).delta || "";
				}
			}

			console.log("Streaming with custom trace - text:", textContent);
			expect(textContent.length).toBeGreaterThan(0);

			trace.output(textContent);
			trace.end();

			// Give time for logs to be queued after stream finalization
			await new Promise((resolve) => setTimeout(resolve, 100));
			await logger.flush();
			await logger.cleanup();
		}, 30000);

		it("should trace response with tool calls", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const tools: OpenAI.Responses.Tool[] = [
				{
					type: "function",
					name: "get_weather",
					description: "Get the current weather in a given location",
					strict: false,
					parameters: {
						type: "object",
						properties: {
							location: {
								type: "string",
								description: "The city and state, e.g. San Francisco, CA",
							},
							unit: {
								type: "string",
								enum: ["celsius", "fahrenheit"],
							},
						},
						required: ["location"],
					},
				},
			];

			const response = await client.responses.create({
				model: "gpt-4o-mini",
				input: "What's the weather like in San Francisco?",
				tools: tools,
				tool_choice: "required",
			});

			console.log("Tool call response:", JSON.stringify(response.output, null, 2));
			expect(response).toBeDefined();
			expect(response.output).toBeDefined();
			expect(response.output.length).toBeGreaterThan(0);

			// Check if there's a function_call in the output
			const hasFunctionCall = response.output.some((item) => item.type === "function_call");
			expect(hasFunctionCall).toBe(true);

			await logger.cleanup();
		}, 30000);

		it("should trace full tool call flow with execution and response", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			// Create a trace to group all generations in the tool call flow
			const trace = logger.trace({ id: uuid() });

			const tools: OpenAI.Responses.Tool[] = [
				{
					type: "function",
					name: "get_weather",
					description: "Get the current weather in a given location",
					strict: false,
					parameters: {
						type: "object",
						properties: {
							location: {
								type: "string",
								description: "The city and state, e.g. San Francisco, CA",
							},
						},
						required: ["location"],
					},
				},
			];

			// First call - model should request a tool call
			const firstResponse = await client.responses.create(
				{
					model: "gpt-4o-mini",
					input: "What's the weather like in New York?",
					tools: tools,
					tool_choice: "required",
				},
				{
					headers: {
						"maxim-trace-id": trace.id,
						"maxim-generation-name": "responses-tool-call-request",
					},
				},
			);

			console.log("First response (tool call request):", JSON.stringify(firstResponse.output, null, 2));

			// Find the function call in the output
			const functionCall = firstResponse.output.find((item) => item.type === "function_call") as
				| OpenAI.Responses.ResponseFunctionToolCall
				| undefined;

			expect(functionCall).toBeDefined();
			expect(functionCall?.name).toBe("get_weather");

			// Simulate tool execution
			const toolResult = JSON.stringify({
				location: "New York, NY",
				temperature: 68,
				unit: "fahrenheit",
				condition: "cloudy",
			});

			// Second call - pass tool result back to model
			const secondResponse = await client.responses.create(
				{
					model: "gpt-4o-mini",
					input: [
						{ role: "user", content: "What's the weather like in New York?" },
						{
							type: "function_call",
							call_id: functionCall!.call_id,
							name: functionCall!.name,
							arguments: functionCall!.arguments,
						} as any,
						{
							type: "function_call_output",
							call_id: functionCall!.call_id,
							output: toolResult,
						} as any,
					],
					tools: tools,
				},
				{
					headers: {
						"maxim-trace-id": trace.id,
						"maxim-generation-name": "responses-tool-call-response",
					},
				},
			);

			console.log("Second response (final answer):", secondResponse.output_text);
			expect(secondResponse.output_text).toBeDefined();
			expect(secondResponse.output_text.toLowerCase()).toContain("new york");

			trace.output(secondResponse.output_text);
			trace.end();
			await logger.cleanup();
		}, 60000);

		it("should trace response with session ID", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const session = logger.session({ id: uuid() });

			const response = await client.responses.create(
				{
					model: "gpt-4o-mini",
					input: "What is the meaning of life? Be brief.",
				},
				{
					headers: {
						"maxim-session-id": session.id,
					},
				},
			);

			console.log("Response with session ID:", response.output_text);
			expect(response).toBeDefined();
			expect(response.output_text).toBeDefined();

			session.end();
			await logger.cleanup();
		}, 30000);

		it("should handle errors gracefully for non-streaming", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			await expect(
				client.responses.create({
					model: "non-existent-model-xyz",
					input: "Hello",
				}),
			).rejects.toThrow();

			await logger.cleanup();
		}, 30000);

		it("should handle errors gracefully for streaming", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const stream = client.responses.stream({
				model: "non-existent-model-xyz",
				input: "Hello",
				stream: true,
			});

			// The error should be thrown when iterating the stream
			await expect(async () => {
				for await (const _ of stream) {
					// consume stream
				}
			}).rejects.toThrow();

			await logger.cleanup();
		}, 30000);

		it("should trace response with complex input including images", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const response = await client.responses.create({
				model: "gpt-4o-mini",
				input: [
					{
						role: "user",
						content: [
							{ type: "input_text", text: "What do you see in this image? Be brief." },
							{
								type: "input_image",
								image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR4Kix9eTNC7mZlFxdscDZ1l_1WYux_ZczNfA&s",
								detail: "auto",
							},
						],
					},
				],
			});

			console.log("Multimodal response:", response.output_text);
			expect(response).toBeDefined();
			expect(response.output_text).toBeDefined();
			expect(response.output_text.length).toBeGreaterThan(0);

			await logger.cleanup();
		}, 30000);
	});
});
