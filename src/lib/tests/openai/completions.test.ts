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

describe("OpenAI Integration Tests", () => {
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

	describe("MaximOpenAIClient Chat Completions", () => {
		it("should trace non-streaming chat completion", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const response = await client.chat.completions.create({
				model: "gpt-4o-mini",
				messages: [
					{ role: "system", content: "You are a helpful assistant." },
					{ role: "user", content: "What is 2 + 2?" },
				],
				temperature: 0.7,
				max_tokens: 100,
			});

			console.log("Non-streaming response:", response.choices[0]?.message?.content);
			expect(response).toBeDefined();
			expect(response.choices).toBeDefined();
			expect(response.choices.length).toBeGreaterThan(0);
			expect(response.choices[0]?.message?.content).toBeDefined();

			await logger.cleanup();
		}, 30000);

		it("should trace streaming chat completion", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const stream = await client.chat.completions.create({
				model: "gpt-4o-mini",
				messages: [
					{ role: "system", content: "You are a helpful assistant." },
					{ role: "user", content: "Count from 1 to 5." },
				],
				temperature: 0.7,
				max_tokens: 100,
				stream: true,
			});

			let fullText = "";
			let chunkCount = 0;

			for await (const chunk of stream) {
				const content = chunk.choices[0]?.delta?.content || "";
				fullText += content;
				chunkCount++;
			}

			console.log("Streaming response:", fullText);
			console.log("Total chunks received:", chunkCount);
			expect(fullText).toBeDefined();
			expect(fullText.length).toBeGreaterThan(0);
			expect(chunkCount).toBeGreaterThan(0);

			// Give time for logs to be queued after stream finalization
			await new Promise((resolve) => setTimeout(resolve, 100));
			await logger.flush();
			await logger.cleanup();
		}, 30000);

		it("should trace chat completion with custom trace ID", async () => {
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
			const generationName = "test-generation";

			const response = await client.chat.completions.create(
				{
					model: "gpt-4o-mini",
					messages: [{ role: "user", content: "Say hello" }],
					max_tokens: 50,
				},
				{
					headers: {
						"maxim-trace-id": trace.id,
						"maxim-generation-name": generationName,
					},
				},
			);

			console.log("Response with custom trace ID:", response.choices[0]?.message?.content);
			expect(response).toBeDefined();
			expect(response.choices[0]?.message?.content).toBeDefined();

			trace.end();
			await logger.cleanup();
		}, 30000);

		it("should trace chat completion with tool calls", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get the current weather in a given location",
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
				},
			];

			const response = await client.chat.completions.create({
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: "What's the weather like in San Francisco?" }],
				tools: tools,
				tool_choice: "auto",
				max_tokens: 200,
			});

			console.log("Tool call response:", JSON.stringify(response.choices[0]?.message, null, 2));
			expect(response).toBeDefined();
			expect(response.choices).toBeDefined();

			// The model should either respond with a tool call or a text message
			const message = response.choices[0]?.message;
			expect(message).toBeDefined();

			await logger.cleanup();
		}, 30000);

		it("should trace streaming chat completion with tool calls", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const openai = new OpenAI({ apiKey: openAIKey });
			const client = new MaximOpenAIClient(openai, logger);

			const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
				{
					type: "function",
					function: {
						name: "get_stock_price",
						description: "Get the current stock price for a given ticker symbol",
						parameters: {
							type: "object",
							properties: {
								ticker: {
									type: "string",
									description: "The stock ticker symbol, e.g. AAPL",
								},
							},
							required: ["ticker"],
						},
					},
				},
			];

			const stream = await client.chat.completions.create({
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: "What's the stock price of Apple?" }],
				tools: tools,
				tool_choice: "auto",
				max_tokens: 200,
				stream: true,
			});

			let chunkCount = 0;
			const toolCallParts: string[] = [];

			for await (const chunk of stream) {
				chunkCount++;
				const toolCalls = chunk.choices[0]?.delta?.tool_calls;
				if (toolCalls) {
					for (const tc of toolCalls) {
						if (tc.function?.arguments) {
							toolCallParts.push(tc.function.arguments);
						}
					}
				}
			}

			console.log("Streaming tool call - chunks received:", chunkCount);
			console.log("Tool call arguments:", toolCallParts.join(""));
			expect(chunkCount).toBeGreaterThan(0);

			// Give time for logs to be queued after stream finalization
			await new Promise((resolve) => setTimeout(resolve, 100));
			await logger.flush();
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

			const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get the current weather in a given location",
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
				},
			];

			const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
				{ role: "user", content: "What's the weather like in San Francisco?" },
			];

			// First call - model should request a tool call
			const firstResponse = await client.chat.completions.create(
				{
					model: "gpt-4o-mini",
					messages: messages,
					tools: tools,
					tool_choice: "required",
					max_tokens: 200,
				},
				{
					headers: {
						"maxim-trace-id": trace.id,
						"maxim-generation-name": "tool-call-request",
					},
				},
			);

			console.log("First response (tool call request):", JSON.stringify(firstResponse.choices[0]?.message, null, 2));
			expect(firstResponse.choices[0]?.message?.tool_calls).toBeDefined();
			expect(firstResponse.choices[0]?.message?.tool_calls?.length).toBeGreaterThan(0);

			const toolCall = firstResponse.choices[0]?.message?.tool_calls?.[0];
			expect(toolCall).toBeDefined();
			expect(toolCall?.type).toBe("function");
			// Access function property with type assertion for function type tool calls
			const functionToolCall = toolCall as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
			expect(functionToolCall.function?.name).toBe("get_weather");

			// Simulate tool execution
			const toolResult = JSON.stringify({
				location: "San Francisco, CA",
				temperature: 72,
				unit: "fahrenheit",
				condition: "sunny",
			});

			// Second call - pass tool result back to model
			const secondMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
				...messages,
				firstResponse.choices[0]?.message as OpenAI.Chat.Completions.ChatCompletionMessageParam,
				{
					role: "tool",
					tool_call_id: functionToolCall.id,
					content: toolResult,
				},
			];

			const secondResponse = await client.chat.completions.create(
				{
					model: "gpt-4o-mini",
					messages: secondMessages,
					tools: tools,
					max_tokens: 200,
				},
				{
					headers: {
						"maxim-trace-id": trace.id,
						"maxim-generation-name": "tool-call-response",
					},
				},
			);

			console.log("Second response (final answer):", secondResponse.choices[0]?.message?.content);
			expect(secondResponse.choices[0]?.message?.content).toBeDefined();
			expect(secondResponse.choices[0]?.message?.content?.toLowerCase()).toContain("san francisco");

			trace.output(secondResponse.choices[0]?.message?.content || "");
			trace.end();
			await logger.cleanup();
		}, 60000);

		it("should trace full streaming tool call flow with execution and response", async () => {
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

			const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
				{
					type: "function",
					function: {
						name: "calculate",
						description: "Perform a mathematical calculation",
						parameters: {
							type: "object",
							properties: {
								expression: {
									type: "string",
									description: "The mathematical expression to evaluate, e.g. '2 + 2'",
								},
							},
							required: ["expression"],
						},
					},
				},
			];

			const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "user", content: "What is 25 * 4 + 10?" }];

			// First call (streaming) - model should request a tool call
			const firstStream = await client.chat.completions.create(
				{
					model: "gpt-4o-mini",
					messages: messages,
					tools: tools,
					tool_choice: "required",
					max_tokens: 200,
					stream: true,
				},
				{
					headers: {
						"maxim-trace-id": trace.id,
						"maxim-generation-name": "streaming-tool-call-request",
					},
				},
			);

			// Collect tool call from stream
			let toolCallId = "";
			let toolCallName = "";
			let toolCallArguments = "";

			for await (const chunk of firstStream) {
				const toolCalls = chunk.choices[0]?.delta?.tool_calls;
				if (toolCalls) {
					for (const tc of toolCalls) {
						if (tc.id) toolCallId = tc.id;
						if (tc.function?.name) toolCallName = tc.function.name;
						if (tc.function?.arguments) toolCallArguments += tc.function.arguments;
					}
				}
			}

			console.log("Streaming tool call - name:", toolCallName);
			console.log("Streaming tool call - arguments:", toolCallArguments);
			expect(toolCallName).toBe("calculate");
			expect(toolCallArguments).toBeDefined();

			// Simulate tool execution
			const parsedArgs = JSON.parse(toolCallArguments);
			const calculationResult = eval(parsedArgs.expression); // Simple eval for test
			const toolResult = JSON.stringify({ result: calculationResult });

			// Second call (streaming) - pass tool result back to model
			const secondMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
				...messages,
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: toolCallId,
							type: "function" as const,
							function: {
								name: toolCallName,
								arguments: toolCallArguments,
							},
						},
					],
				} as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam,
				{
					role: "tool",
					tool_call_id: toolCallId,
					content: toolResult,
				},
			];

			const secondStream = await client.chat.completions.create(
				{
					model: "gpt-4o-mini",
					messages: secondMessages,
					tools: tools,
					max_tokens: 200,
					stream: true,
				},
				{
					headers: {
						"maxim-trace-id": trace.id,
						"maxim-generation-name": "streaming-tool-call-response",
					},
				},
			);

			let finalResponse = "";
			for await (const chunk of secondStream) {
				const content = chunk.choices[0]?.delta?.content || "";
				finalResponse += content;
			}

			console.log("Streaming final response:", finalResponse);
			expect(finalResponse).toBeDefined();
			expect(finalResponse.length).toBeGreaterThan(0);
			// The response should contain the result (110)
			expect(finalResponse).toContain("110");

			// Give time for logs to be queued after stream finalization
			await new Promise((resolve) => setTimeout(resolve, 100));

			trace.output(finalResponse);
			trace.end();
			await logger.flush();
			await logger.cleanup();
		}, 60000);

		it("should handle multimodal messages with images", async () => {
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

			// Use a simple public image URL
			const response = await client.chat.completions.create(
				{
					model: "gpt-4o-mini",
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: "What do you see in this image?" },
								{
									type: "image_url",
									image_url: {
										url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR4Kix9eTNC7mZlFxdscDZ1l_1WYux_ZczNfA&s",
									},
								},
							],
						},
					],
					max_tokens: 150,
				},
				{
					headers: {
						"maxim-session-id": session.id,
						"maxim-trace-tags": JSON.stringify({
							session_type: "test",
							user_id: "123",
						}),
					},
				},
			);

			console.log("Multimodal response:", response.choices[0]?.message?.content);
			expect(response).toBeDefined();
			expect(response.choices[0]?.message?.content).toBeDefined();

			session.end();
			await logger.cleanup();
		}, 30000);

		it("should handle errors gracefully", async () => {
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
				client.chat.completions.create({
					model: "non-existent-model",
					messages: [{ role: "user", content: "Hello" }],
				}),
			).rejects.toThrow();

			await logger.cleanup();
		}, 30000);
	});
});
