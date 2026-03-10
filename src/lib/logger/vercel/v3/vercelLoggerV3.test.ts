import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateText, Output, stepCountIs, streamText, tool } from "ai";
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { z } from "zod/v3";
import { Maxim } from "../../../../../index";
import { MaximVercelProviderMetadata, wrapMaximAISDKModel } from "../../../../../vercel-ai-sdk";

config();

let maxim: Maxim;

// local config
const openAIKey = process.env["OPENAI_API_KEY"];
const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
const apiKey = process.env["MAXIM_API_KEY"];
const baseUrl = process.env["MAXIM_BASE_URL"];
const repoId = process.env["MAXIM_LOG_REPO_ID"];

describe("AI SDK V3 Specification Tests", () => {
	beforeAll(async () => {
		if (!apiKey || !repoId) {
			throw new Error("MAXIM_API_KEY & LOG_REPO_ID environment variables are required");
		}
		maxim = new Maxim({
			baseUrl: baseUrl,
			apiKey: apiKey,
			debug: true,
		});
	});

	afterAll(async () => {
		await maxim.cleanup();
	});

	describe("OpenAI V3 Model Tests", () => {
		it("should trace OpenAI chat model with basic text using V3 specification", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			// Use a model that supports V3 specification
			const model = wrapMaximAISDKModel(openai.chat("gpt-5.2"), logger);
			const trace = logger.trace({
				id: uuid(),
				name: "Testing V3 specification for generateText",
				tags: {
					specification_version: "v3",
					test_type: "basic_text",
				},
			});

			const query = "What is the capital of France?";
			trace.input(query);

			try {
				const response = await generateText({
					model: model,
					temperature: 0.3,
					topP: 1,
					system: "Be concise in your answers",
					prompt: query,
					maxOutputTokens: 100,
					providerOptions: {
						maxim: {
							traceId: trace.id,
							traceName: "V3 Basic Text Generation",
							generationName: "France Capital Query",
							generationTags: {
								query_type: "geography",
								specification: "v3",
							},
							traceTags: {
								test_suite: "v3_specification",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				console.log("OpenAI V3 response for basic generateText", response.text);
				expect(response.text).toBeDefined();
				expect(response.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V3 basic text generation:", error);
				throw error;
			}
		}, 20000);

		it("should handle V3 streaming text generation", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-5.1"), logger);

			try {
				const result = streamText({
					model: model,
					maxOutputTokens: 200,
					messages: [
						{
							role: "system",
							content: "You are a helpful assistant that writes poetry.",
						},
						{
							role: "user",
							content: "Write a short poem about technology.",
						},
					],
					providerOptions: {
						maxim: {
							traceName: "V3 Stream Text Generation",
							generationName: "Technology Poem Stream",
							generationTags: {
								content_type: "poetry",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				const text = await result.text;
				console.log("OpenAI V3 streaming response", text);
				expect(text).toBeDefined();
				expect(text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V3 stream text generation:", error);
				throw error;
			}
		}, 20000);

		it("should handle V3 object generation with schema", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-5.1"), logger);

			try {
				const result = await generateText({
					model: model,
					output: Output.object({
						schema: z.object({
							city: z.string().describe("Name of a major city"),
							country: z.string().describe("Country where the city is located"),
							population: z.number().describe("Approximate population"),
							landmarks: z.array(z.string()).describe("Famous landmarks in the city"),
						}),
					}),
					prompt: "Generate information about Tokyo.",
					providerOptions: {
						maxim: {
							traceName: "V3 Object Generation",
							generationName: "Tokyo City Info",
							generationTags: {
								output_type: "structured_object",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("OpenAI V3 object generation result", result.response.body);
				expect(result.text).toBeDefined();
				expect(result.content).toBeDefined();
			} catch (error) {
				console.error("Error in V3 object generation:", error);
				throw error;
			}
		}, 20000);

		it("should handle V3 streaming object generation", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			try {
				const result = streamText({
					model: model,
					output: Output.object({
						schema: z.object({
							title: z.string().describe("Book title"),
							author: z.string().describe("Book author"),
							genre: z.string().describe("Book genre"),
							summary: z.string().describe("Brief book summary"),
							chapters: z.array(z.string()).describe("Chapter titles"),
						}),
					}),
					prompt: "Generate a fictional book about space exploration.",
					providerOptions: {
						maxim: {
							traceName: "V3 Stream Object Generation",
							generationName: "Space Book Stream",
							generationTags: {
								output_type: "streaming_object",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				const object = await result.output;
				console.log("OpenAI V3 streaming object result", object);
				expect(object).toBeDefined();
				expect(object.title).toBeDefined();
			} catch (error) {
				console.error("Error in V3 streaming object generation:", error);
				throw error;
			}
		}, 20000);

		it("should handle V3 tool calls with proper logging and execution", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-5.1"), logger);

			try {
				const result = await generateText({
					model: model,
					tools: {
						calculator: tool({
							description: "Perform basic arithmetic operations",
							inputSchema: z.object({
								operation: z.enum(["add", "subtract", "multiply", "divide"]),
								a: z.number().describe("First number"),
								b: z.number().describe("Second number"),
							}),
							needsApproval: true,
							execute: async ({ operation, a, b }) => {
								console.log(`[CALCULATOR] Executing ${operation}(${a}, ${b})`);
								switch (operation) {
									case "add":
										return { result: a + b };
									case "subtract":
										return { result: a - b };
									case "multiply":
										return { result: a * b };
									case "divide":
										return { result: b !== 0 ? a / b : "Cannot divide by zero" };
									default:
										return { result: "Invalid operation" };
								}
							},
						}),
					},
					prompt: "Calculate 15 multiplied by 8, then add 25 to the result.",
					providerOptions: {
						maxim: {
							traceName: "V3 Tool Call Test - Single Execution",
							generationName: "Calculator Operations",
							generationTags: {
								tool_usage: "calculator",
								specification: "v3",
								test_type: "single_tool_execution",
							},
						} as MaximVercelProviderMetadata,
					},
					stopWhen: stepCountIs(5),
				});

				console.log("OpenAI V3 tool call result", result.text);
				console.log("Tool calls executed:", result.toolCalls?.length || 0);
				expect(result.text).toBeDefined();
				expect(result.toolCalls).toBeDefined();
				expect(result.toolCalls?.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V3 tool call:", error);
				throw error;
			}
		}, 20000);

		it("should capture tool execution error when using real model", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-5.1"), logger);

			const failingToolError = new Error("Tool execution failed: external service unavailable");

			try {
				await generateText({
					model: model,
					tools: {
						calculator: tool({
							description: "Perform basic arithmetic operations",
							inputSchema: z.object({
								operation: z.enum(["add", "subtract", "multiply", "divide"]),
								a: z.number().describe("First number"),
								b: z.number().describe("Second number"),
							}),
							execute: async (): Promise<{ result: number }> => {
								throw failingToolError;
							},
						}),
					},
					prompt: "Calculate 15 multiplied by 8.",
					providerOptions: {
						maxim: {
							traceName: "V3 Tool Execution Error Test",
							generationName: "Calculator Error",
							generationTags: {
								tool_usage: "calculator",
								specification: "v3",
								test_type: "tool_execution_error",
							},
						} as MaximVercelProviderMetadata,
					},
					stopWhen: stepCountIs(5),
				});
			} catch (error) {
				expect(error).toBe(failingToolError);
				expect((error as Error).message).toBe("Tool execution failed: external service unavailable");
			}
		}, 20000);

		it("should handle V3 multiple sequential tool calls in one trace", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-5.1"), logger);

			try {
				const result = await generateText({
					model: model,
					tools: {
						calculator: tool({
							description: "Perform basic arithmetic operations",
							inputSchema: z.object({
								operation: z.enum(["add", "subtract", "multiply", "divide"]),
								a: z.number().describe("First number"),
								b: z.number().describe("Second number"),
							}),
							execute: async ({ operation, a, b }) => {
								console.log(`[CALCULATOR] Executing ${operation}(${a}, ${b})`);
								switch (operation) {
									case "add":
										return { result: a + b };
									case "subtract":
										return { result: a - b };
									case "multiply":
										return { result: a * b };
									case "divide":
										return { result: b !== 0 ? a / b : "Cannot divide by zero" };
									default:
										return { result: "Invalid operation" };
								}
							},
						}),
						getWeather: tool({
							description: "Get current weather information for a city",
							inputSchema: z.object({
								city: z.string().describe("Name of the city"),
								unit: z.enum(["celsius", "fahrenheit"]).describe("Temperature unit"),
							}),
							execute: async ({ city, unit }) => {
								console.log(`[WEATHER] Getting weather for ${city} in ${unit}`);
								return {
									city,
									temperature: unit === "celsius" ? 22 : 72,
									unit,
									condition: "sunny",
									humidity: 65,
								};
							},
						}),
					},
					prompt: "What's 10 + 5? Also, what's the weather in New York? Use Celsius.",
					providerOptions: {
						maxim: {
							traceName: "V3 Multiple Tool Calls Test",
							generationName: "Multi-Tool Operations",
							generationTags: {
								tool_usage: "calculator,weather",
								specification: "v3",
								test_type: "multiple_tools",
							},
						} as MaximVercelProviderMetadata,
					},
					stopWhen: stepCountIs(5),
				});

				console.log("OpenAI V3 multiple tool calls result", result.text);
				console.log("Tool calls executed:", result.toolCalls?.length || 0);
				expect(result.text).toBeDefined();
				expect(result.toolCalls).toBeDefined();
			} catch (error) {
				console.error("Error in V3 multiple tool calls:", error);
				throw error;
			}
		}, 20000);

		it("should handle V3 streaming tool calls with execution", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-5.1"), logger);

			try {
				const result = streamText({
					model: model,
					tools: {
						calculator: tool({
							description: "Perform basic arithmetic operations",
							inputSchema: z.object({
								operation: z.enum(["add", "subtract", "multiply", "divide"]),
								a: z.number().describe("First number"),
								b: z.number().describe("Second number"),
							}),
							execute: async ({ operation, a, b }) => {
								console.log(`[CALCULATOR STREAM] Executing ${operation}(${a}, ${b})`);
								switch (operation) {
									case "add":
										return { result: a + b };
									case "subtract":
										return { result: a - b };
									case "multiply":
										return { result: a * b };
									case "divide":
										return { result: b !== 0 ? a / b : "Cannot divide by zero" };
									default:
										return { result: "Invalid operation" };
								}
							},
						}),
					},
					prompt: "Calculate 20 multiplied by 3, then subtract 10 from the result.",
					providerOptions: {
						maxim: {
							traceName: "V3 Streaming Tool Call Test",
							generationName: "Stream Calculator Operations",
							generationTags: {
								tool_usage: "calculator",
								specification: "v3",
								test_type: "streaming_tool_execution",
							},
						} as MaximVercelProviderMetadata,
					},
					stopWhen: stepCountIs(5),
				});

				const text = await result.text;
				const toolCalls = await result.toolCalls;
				console.log("OpenAI V3 streaming tool call result", text);
				console.log("Tool calls executed:", toolCalls?.length || 0);
				expect(text).toBeDefined();
				expect(toolCalls).toBeDefined();
			} catch (error) {
				console.error("Error in V3 streaming tool call:", error);
				throw error;
			}
		}, 20000);

		it("should handle V3 complex multi-step tool execution", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-5.1"), logger);

			try {
				const result = await generateText({
					model: model,
					tools: {
						calculator: tool({
							description: "Perform basic arithmetic operations",
							inputSchema: z.object({
								operation: z.enum(["add", "subtract", "multiply", "divide"]),
								a: z.number().describe("First number"),
								b: z.number().describe("Second number"),
							}),
							execute: async ({ operation, a, b }) => {
								console.log(`[CALCULATOR] Executing ${operation}(${a}, ${b})`);
								switch (operation) {
									case "add":
										return { result: a + b };
									case "subtract":
										return { result: a - b };
									case "multiply":
										return { result: a * b };
									case "divide":
										return { result: b !== 0 ? a / b : "Cannot divide by zero" };
									default:
										return { result: "Invalid operation" };
								}
							},
						}),
						getWeather: tool({
							description: "Get current weather information for a city",
							inputSchema: z.object({
								city: z.string().describe("Name of the city"),
								unit: z.enum(["celsius", "fahrenheit"]).describe("Temperature unit"),
							}),
							execute: async ({ city, unit }) => {
								console.log(`[WEATHER] Getting weather for ${city} in ${unit}`);
								return {
									city,
									temperature: unit === "celsius" ? 22 : 72,
									unit,
									condition: "sunny",
									humidity: 65,
								};
							},
						}),
					},
					prompt: "Calculate 15 multiplied by 8, then add 25 to the result. After that, tell me the weather in San Francisco in Celsius.",
					providerOptions: {
						maxim: {
							traceName: "V3 Complex Multi-Step Tool Execution",
							generationName: "Complex Tool Operations",
							generationTags: {
								tool_usage: "calculator,weather",
								specification: "v3",
								test_type: "complex_multi_step",
							},
						} as MaximVercelProviderMetadata,
					},
					stopWhen: stepCountIs(10),
				});

				console.log("OpenAI V3 complex tool execution result", result.text);
				console.log("Tool calls executed:", result.toolCalls?.length || 0);
				if (result.toolCalls && result.toolCalls.length > 0) {
					result.toolCalls.forEach((tc, idx) => {
						console.log(`  Tool Call ${idx + 1}:`, tc.toolName, JSON.stringify(tc));
					});
				}
				expect(result.text).toBeDefined();
				expect(result.toolCalls).toBeDefined();
			} catch (error) {
				console.error("Error in V3 complex tool execution:", error);
				throw error;
			}
		}, 30000);

		it("should handle V3 tool calls with session context", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-5.1"), logger);
			const sessionId = uuid();

			try {
				const result = await generateText({
					model: model,
					tools: {
						calculator: tool({
							description: "Perform basic arithmetic operations",
							inputSchema: z.object({
								operation: z.enum(["add", "subtract", "multiply", "divide"]),
								a: z.number().describe("First number"),
								b: z.number().describe("Second number"),
							}),
							execute: async ({ operation, a, b }) => {
								console.log(`[CALCULATOR SESSION] Executing ${operation}(${a}, ${b})`);
								switch (operation) {
									case "add":
										return { result: a + b };
									case "subtract":
										return { result: a - b };
									case "multiply":
										return { result: a * b };
									case "divide":
										return { result: b !== 0 ? a / b : "Cannot divide by zero" };
									default:
										return { result: "Invalid operation" };
								}
							},
						}),
					},
					prompt: "Calculate 100 divided by 4, then multiply the result by 3.",
					providerOptions: {
						maxim: {
							sessionId: sessionId,
							sessionName: "V3 Tool Call Session Test",
							traceName: "Session Tool Execution",
							generationName: "Session Calculator Operations",
							sessionTags: {
								test_type: "tool_call_session",
								specification: "v3",
							},
							generationTags: {
								tool_usage: "calculator",
								specification: "v3",
								test_type: "session_tool_execution",
							},
						} as MaximVercelProviderMetadata,
					},
					stopWhen: stepCountIs(5),
				});

				console.log("OpenAI V3 session tool call result", result.text);
				console.log("Tool calls executed:", result.toolCalls?.length || 0);
				expect(result.text).toBeDefined();
				expect(result.toolCalls).toBeDefined();
			} catch (error) {
				console.error("Error in V3 session tool call:", error);
				throw error;
			}
		}, 20000);

		const sessionId = uuid();
		it("should handle V3 session and trace management", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-5.1"), logger);

			try {
				// First call in session
				const result1 = await generateText({
					model: model,
					prompt: "Hello, I'm starting a conversation about cooking.",
					providerOptions: {
						maxim: {
							sessionId: sessionId,
							sessionName: "V3 Cooking Conversation",
							traceName: "Conversation Start",
							sessionTags: {
								topic: "cooking",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				// Second call in same session
				const result2 = await generateText({
					model: model,
					prompt: "What's a good recipe for pasta?",
					providerOptions: {
						maxim: {
							sessionId: sessionId,
							sessionName: "V3 Cooking Conversation",
							traceName: "Recipe Request",
							sessionTags: {
								topic: "cooking",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("V3 Session - First response:", result1.text);
				console.log("V3 Session - Second response:", result2.text);

				expect(result1.text).toBeDefined();
				expect(result2.text).toBeDefined();
			} catch (error) {
				console.error("Error in V3 session management:", error);
				throw error;
			}
		}, 20000);

		it("should handle V3 multi-modal input with images", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-5.1"), logger);

			try {
				const result = await generateText({
					model: model,
					maxOutputTokens: 30000,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: "Describe what you see in this image in detail.",
								},
								{
									type: "image",
									image: new URL(
										"https://us.robosen.com/cdn/shop/files/elite_op_robot_form_pc.webp?v=1719307595&width=2000",
									),
								},
							],
						},
					],
					providerOptions: {
						maxim: {
							traceName: "V3 Multi-modal Analysis",
							generationName: "Image Description",
							generationTags: {
								input_type: "multimodal",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("OpenAI V3 image analysis result", result.text);
				expect(result.text).toBeDefined();
				expect(result.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V3 multi-modal input:", error);
				throw error;
			}
		}, 20000);

		it("should handle V3 multi-modal input with local file path", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			// Path to test image file - user should place a test image file here
			const testImagePath = path.join(process.cwd(), "test-image.png");

			// Skip test if file doesn't exist
			if (!fs.existsSync(testImagePath)) {
				console.warn(`Test image not found at ${testImagePath}. Skipping test. Please create a test image file at this path.`);
				return;
			}

			try {
				// Read the local file into a buffer
				const fileBuffer = fs.readFileSync(testImagePath);

				const result = await generateText({
					model: model,
					maxOutputTokens: 200,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: "Describe what you see in this image in detail.",
								},
								{
									type: "file",
									data: fileBuffer,
									mediaType: "image/png",
								},
							],
						},
					],
					providerOptions: {
						maxim: {
							traceName: "V3 Multi-modal Local File Path Test",
							generationName: "Local File Path Image Description",
							generationTags: {
								input_type: "multimodal_local_file_path",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("OpenAI V3 local file path image analysis result", result.text);
				expect(result.text).toBeDefined();
				expect(result.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V3 multi-modal local file path input:", error);
				throw error;
			}
		}, 20000);
	});

	describe("Anthropic V3 Model Tests", () => {
		it("should trace Anthropic model with V3 specification", async () => {
			if (!repoId || !anthropicApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and ANTHROPIC_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(anthropic("claude-opus-4-5-20251101"), logger);

			try {
				const response = await generateText({
					model: model,
					temperature: 0.2,
					maxOutputTokens: 150,
					system: "You are a helpful assistant that provides concise answers.",
					prompt: "Explain quantum computing in simple terms.",
					providerOptions: {
						maxim: {
							traceName: "V3 Anthropic Text Generation",
							generationName: "Quantum Computing Explanation",
							generationTags: {
								provider: "anthropic",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("Anthropic V3 response", response.text);
				expect(response.text).toBeDefined();
				expect(response.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in Anthropic V3 generation:", error);
				throw error;
			}
		}, 20000);

		it("should handle Anthropic V3 streaming", async () => {
			if (!repoId || !anthropicApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and ANTHROPIC_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(anthropic("claude-opus-4-5-20251101"), logger);

			try {
				const result = streamText({
					model: model,
					temperature: 0.3,
					maxOutputTokens: 200,
					prompt: "Write a brief story about a robot learning to paint.",
					providerOptions: {
						maxim: {
							traceName: "V3 Anthropic Stream",
							generationName: "Robot Painting Story",
							generationTags: {
								provider: "anthropic",
								specification: "v3",
								content_type: "creative_writing",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				const text = await result.text;
				console.log("Anthropic V3 streaming result", text);
				expect(text).toBeDefined();
				expect(text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in Anthropic V3 streaming:", error);
				throw error;
			}
		}, 20000);
	});

	describe("V3 Error Handling Tests", () => {
		it("should properly handle and log errors in V3 specification", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			try {
				// Intentionally cause an error with invalid parameters
				await generateText({
					model: model,
					maxOutputTokens: -1, // Invalid token count
					prompt: "This should cause an error.",
					providerOptions: {
						maxim: {
							traceName: "V3 Error Handling Test",
							generationName: "Invalid Parameters",
							generationTags: {
								test_type: "error_handling",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				// If we reach here, the test should fail
				fail("Expected an error to be thrown");
			} catch (error) {
				console.log("Expected error caught in V3 error handling test:", error);
				expect(error).toBeDefined();
			}
		}, 20000);

		it("should capture a standard Error thrown by the model in doGenerate", async () => {
			if (!repoId) throw new Error("MAXIM_LOG_REPO_ID environment variable is required");
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			// Mock model that throws a standard Error with a code property
			const fakeModel = {
				specificationVersion: "v3" as const,
				provider: "openai",
				modelId: "fake-model",
				supportedUrls: {},
				doGenerate: async () => {
					const err = new TypeError("context length exceeded");
					(err as unknown as Record<string, unknown>)["code"] = "context_length_exceeded";
					throw err;
				},
				doStream: async () => {
					throw new Error("not used");
				},
			};

			const model = wrapMaximAISDKModel(fakeModel as never, logger);

			try {
				await generateText({
					model,
					prompt: "trigger a standard Error",
					providerOptions: {
						maxim: {
							traceName: "V3 Standard Error Test",
							generationName: "Standard Error Generation",
						} as MaximVercelProviderMetadata,
					},
				});
				fail("Expected an error to be thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(TypeError);
				expect((error as TypeError).message).toBe("context length exceeded");
			}
		}, 10000);

		it("should capture an API-style plain object error thrown by the model in doGenerate", async () => {
			if (!repoId) throw new Error("MAXIM_LOG_REPO_ID environment variable is required");
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			// Mock model that throws a plain object (as some API clients do)
			const fakeModel = {
				specificationVersion: "v3" as const,
				provider: "openai",
				modelId: "fake-model",
				supportedUrls: {},
				doGenerate: async () => {
					 
					throw { message: "rate limit exceeded", code: "429", type: "rate_limit_error" };
				},
				doStream: async () => {
					throw new Error("not used");
				},
			};

			const model = wrapMaximAISDKModel(fakeModel as never, logger);

			try {
				await generateText({
					model,
					prompt: "trigger a plain object error",
					providerOptions: {
						maxim: {
							traceName: "V3 Plain Object Error Test",
							generationName: "Plain Object Error Generation",
						} as MaximVercelProviderMetadata,
					},
				});
				fail("Expected an error to be thrown");
			} catch (error) {
				// The error is re-thrown as-is so the caller can inspect it
				expect(error).toEqual({ message: "rate limit exceeded", code: "429", type: "rate_limit_error" });
			}
		}, 10000);

		it("should capture a standard Error thrown by the model in doStream", async () => {
			if (!repoId) throw new Error("MAXIM_LOG_REPO_ID environment variable is required");
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			// Mock model whose stream reader throws mid-stream
			const fakeModel = {
				specificationVersion: "v3" as const,
				provider: "openai",
				modelId: "fake-model",
				supportedUrls: {},
				doGenerate: async () => {
					throw new Error("not used");
				},
				doStream: async () => ({
					stream: new ReadableStream({
						start(controller) {
							controller.error(new RangeError("stream interrupted"));
						},
					}),
					rawCall: { rawPrompt: null, rawSettings: {} },
					rawResponse: { headers: {} },
					request: { body: "" },
					warnings: [],
				}),
			};

			const model = wrapMaximAISDKModel(fakeModel as never, logger);

			try {
				const result = streamText({
					model,
					prompt: "trigger a stream error",
					providerOptions: {
						maxim: {
							traceName: "V3 Stream Error Test",
							generationName: "Stream Error Generation",
						} as MaximVercelProviderMetadata,
					},
				});
				await result.text;
				fail("Expected an error to be thrown");
			} catch (error) {
				expect(error).toBeDefined();
			}
		}, 30000);

		it("should capture a plain object error thrown during doStream setup", async () => {
			if (!repoId) throw new Error("MAXIM_LOG_REPO_ID environment variable is required");
			const logger = await maxim.logger({ id: repoId });
			if (!logger) throw new Error("Logger is not available");

			// Mock model that throws before returning a stream (doStream itself rejects)
			const fakeModel = {
				specificationVersion: "v3" as const,
				provider: "openai",
				modelId: "fake-model",
				supportedUrls: {},
				doGenerate: async () => {
					throw new Error("not used");
				},
				doStream: async () => {
					 
					throw { message: "upstream unavailable", code: "503", type: "service_unavailable" };
				},
			};

			const model = wrapMaximAISDKModel(fakeModel as never, logger);

			try {
				const result = streamText({
					model,
					prompt: "trigger a doStream setup error",
					providerOptions: {
						maxim: {
							traceName: "V3 doStream Setup Error Test",
							generationName: "doStream Setup Error",
						} as MaximVercelProviderMetadata,
					},
				});
				await result.text;
				fail("Expected an error to be thrown");
			} catch (error) {
				expect(error).toBeDefined();
			}
		}, 10000);
	});

	describe("V3 Performance and Edge Cases", () => {
		it("should handle concurrent V3 model calls", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			try {
				const promises = Array.from({ length: 3 }, (_, i) =>
					generateText({
						model: model,
						maxOutputTokens: 50,
						prompt: `Generate a random fact about space. Call ${i + 1}`,
						providerOptions: {
							maxim: {
								traceName: `V3 Concurrent Call ${i + 1}`,
								generationName: `Space Fact ${i + 1}`,
								generationTags: {
									call_number: `${i + 1}`,
									specification: "v3",
									test_type: "concurrent",
								},
							} as MaximVercelProviderMetadata,
						},
					}),
				);

				const results = await Promise.all(promises);

				console.log(
					"V3 Concurrent call results:",
					results.map((r) => r.text),
				);
				expect(results).toHaveLength(3);
				results.forEach((result) => {
					expect(result.text).toBeDefined();
					expect(result.text.length).toBeGreaterThan(0);
				});
			} catch (error) {
				console.error("Error in V3 concurrent calls:", error);
				throw error;
			}
		}, 30000);

		it("should handle V3 model with custom span and trace IDs", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);
			const customTraceId = uuid();
			const customSpanId = uuid();

			try {
				const result = await generateText({
					model: model,
					maxOutputTokens: 100,
					prompt: "What is the meaning of life?",
					providerOptions: {
						maxim: {
							traceId: customTraceId,
							spanId: customSpanId,
							traceName: "V3 Custom IDs Test",
							spanName: "Philosophy Question",
							generationName: "Life Meaning Query",
							generationTags: {
								custom_ids: "true",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("V3 Custom IDs result", result.text);
				expect(result.text).toBeDefined();
				expect(result.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V3 custom IDs test:", error);
				throw error;
			}
		}, 20000);
	});

	describe("V3-Specific Features", () => {
		it("should handle V3 file content processing", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			try {
				// Simulate V3 file handling with text content
				const result = await generateText({
					model: model,
					maxOutputTokens: 200,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: "Analyze this file content and provide a summary:",
								},
								// Note: In real V3 implementation, this would be a file type
								{
									type: "text",
									text: "File content: This is a sample document about renewable energy sources including solar, wind, and hydroelectric power.",
								},
							],
						},
					],
					providerOptions: {
						maxim: {
							traceName: "V3 File Content Analysis",
							generationName: "Document Summary",
							generationTags: {
								input_type: "file_content",
								specification: "v3",
								content_type: "document",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("V3 file content analysis result", result.text);
				expect(result.text).toBeDefined();
				expect(result.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V3 file content processing:", error);
				throw error;
			}
		}, 20000);

		it("should handle V3 advanced tool result processing", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			try {
				const result = await generateText({
					model: model,
					tools: {
						dataAnalyzer: tool({
							description: "Analyze data and return structured results",
							inputSchema: z.object({
								data: z.array(z.number()).describe("Array of numbers to analyze"),
								analysisType: z.enum(["mean", "median", "mode", "range"]).describe("Type of analysis"),
							}),
							execute: async ({ data, analysisType }) => {
								switch (analysisType) {
									case "mean":
										return {
											result: data.reduce((a, b) => a + b, 0) / data.length,
											type: "mean",
											dataPoints: data.length,
										};
									case "median":
										const sorted = [...data].sort((a, b) => a - b);
										const mid = Math.floor(sorted.length / 2);
										return {
											result: sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid],
											type: "median",
											dataPoints: data.length,
										};
									case "range":
										return {
											result: Math.max(...data) - Math.min(...data),
											type: "range",
											min: Math.min(...data),
											max: Math.max(...data),
											dataPoints: data.length,
										};
									default:
										return { result: "Analysis type not supported", type: "error" };
								}
							},
						}),
					},
					stopWhen: stepCountIs(10),
					prompt: "Analyze this dataset: [10, 15, 20, 25, 30, 35, 40] and calculate the mean and range.",
					providerOptions: {
						maxim: {
							traceName: "V3 Advanced Tool Processing",
							generationName: "Data Analysis Tool",
							generationTags: {
								tool_type: "data_analyzer",
								specification: "v3",
								analysis_complexity: "advanced",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("V3 advanced tool result", result.text);
				expect(result.text).toBeDefined();
				expect(result.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V3 advanced tool processing:", error);
				throw error;
			}
		}, 20000);

		it("should handle V3 complex multi-turn conversation", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);
			const conversationTraceId = uuid();

			try {
				// First turn
				const turn1 = await generateText({
					model: model,
					maxOutputTokens: 100,
					messages: [
						{
							role: "user",
							content: "I'm planning a trip to Japan. What should I know about the culture?",
						},
					],
					providerOptions: {
						maxim: {
							traceId: conversationTraceId,
							traceName: "V3 Multi-turn Japan Conversation",
							generationName: "Culture Question",
							generationTags: {
								turn: "1",
								topic: "japan_culture",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				// Second turn - building on the conversation
				const turn2 = await generateText({
					model: model,
					maxOutputTokens: 100,
					messages: [
						{
							role: "user",
							content: "I'm planning a trip to Japan. What should I know about the culture?",
						},
						{
							role: "assistant",
							content: turn1.text,
						},
						{
							role: "user",
							content: "That's helpful! What about food etiquette specifically?",
						},
					],
					providerOptions: {
						maxim: {
							traceId: conversationTraceId,
							traceName: "V3 Multi-turn Japan Conversation",
							generationName: "Food Etiquette Question",
							generationTags: {
								turn: "2",
								topic: "food_etiquette",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				// Third turn - more specific follow-up
				const turn3 = await generateText({
					model: model,
					maxOutputTokens: 100,
					messages: [
						{
							role: "user",
							content: "I'm planning a trip to Japan. What should I know about the culture?",
						},
						{
							role: "assistant",
							content: turn1.text,
						},
						{
							role: "user",
							content: "That's helpful! What about food etiquette specifically?",
						},
						{
							role: "assistant",
							content: turn2.text,
						},
						{
							role: "user",
							content: "Should I learn some basic Japanese phrases before going?",
						},
					],
					providerOptions: {
						maxim: {
							traceId: conversationTraceId,
							traceName: "V3 Multi-turn Japan Conversation",
							generationName: "Language Question",
							generationTags: {
								turn: "3",
								topic: "language_learning",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("V3 Multi-turn conversation results:");
				console.log("Turn 1:", turn1.text);
				console.log("Turn 2:", turn2.text);
				console.log("Turn 3:", turn3.text);

				expect(turn1.text).toBeDefined();
				expect(turn2.text).toBeDefined();
				expect(turn3.text).toBeDefined();
			} catch (error) {
				console.error("Error in V3 multi-turn conversation:", error);
				throw error;
			}
		}, 30000);

		it("should handle V3 specification version validation", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}

			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			// Verify that the wrapped model maintains V3 specification
			expect(model.specificationVersion).toBe("v3");
			expect(model.modelId).toBeDefined();
			expect(model.provider).toBeDefined();

			try {
				const result = await generateText({
					model: model,
					maxOutputTokens: 50,
					prompt: "Hello, this is a V3 specification test.",
					providerOptions: {
						maxim: {
							traceName: "V3 Specification Validation",
							generationName: "Spec Version Test",
							generationTags: {
								test_type: "specification_validation",
								specification: "v3",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("V3 specification validation result", result.text);
				expect(result.text).toBeDefined();
			} catch (error) {
				console.error("Error in V3 specification validation:", error);
				throw error;
			}
		}, 20000);
	});
});
