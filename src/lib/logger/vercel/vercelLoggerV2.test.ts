import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject, generateText, streamObject, streamText, tool } from "ai";
import { config } from "dotenv";
import { v4 as uuid } from "uuid";
import { z } from "zod/v3";
import { Maxim } from "../../../../index";
import { MaximVercelProviderMetadata, wrapMaximAISDKModel } from "../../../../vercel-ai-sdk";

config();

let maxim: Maxim;

// local config
const openAIKey = process.env["OPENAI_API_KEY"];
const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
const apiKey = process.env["MAXIM_API_KEY"];
const baseUrl = process.env["MAXIM_BASE_URL"];
const repoId = process.env["MAXIM_LOG_REPO_ID"];

describe("AI SDK V2 Specification Tests", () => {
	beforeAll(async () => {
		if (!baseUrl || !apiKey || !repoId) {
			throw new Error("MAXIM_BASE_URL, MAXIM_API_KEY & LOG_REPO_ID environment variables are required");
		}
		maxim = new Maxim({
			baseUrl: baseUrl,
			apiKey: apiKey,
		});
	});

	afterAll(async () => {
		await maxim.cleanup();
	});

	describe("OpenAI V2 Model Tests", () => {
		it("should trace OpenAI chat model with basic text using V2 specification", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			
			// Use a model that supports V2 specification
			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);
			const trace = logger.trace({
				id: uuid(),
				name: "Testing V2 specification for generateText",
				tags: {
					specification_version: "v2",
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
							traceName: "V2 Basic Text Generation",
							generationName: "France Capital Query",
							generationTags: {
								query_type: "geography",
								specification: "v2",
							},
							traceTags: {
								test_suite: "v2_specification",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				console.log("OpenAI V2 response for basic generateText", response.text);
				expect(response.text).toBeDefined();
				expect(response.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V2 basic text generation:", error);
				throw error;
			}
		}, 20000);

		it("should handle V2 streaming text generation", async () => {
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
							traceName: "V2 Stream Text Generation",
							generationName: "Technology Poem Stream",
							generationTags: {
								content_type: "poetry",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				const text = await result.text;
				console.log("OpenAI V2 streaming response", text);
				expect(text).toBeDefined();
				expect(text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V2 stream text generation:", error);
				throw error;
			}
		}, 20000);

		it("should handle V2 object generation with schema", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			
			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			try {
				const result = await generateObject({
					model: model,
					schema: z.object({
						city: z.string().describe("Name of a major city"),
						country: z.string().describe("Country where the city is located"),
						population: z.number().describe("Approximate population"),
						landmarks: z.array(z.string()).describe("Famous landmarks in the city"),
					}),
					prompt: "Generate information about Tokyo.",
					providerOptions: {
						maxim: {
							traceName: "V2 Object Generation",
							generationName: "Tokyo City Info",
							generationTags: {
								output_type: "structured_object",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				console.log("OpenAI V2 object generation result", result.object);
				expect(result.object).toBeDefined();
				expect(result.object.city).toBeDefined();
				expect(result.object.country).toBeDefined();
			} catch (error) {
				console.error("Error in V2 object generation:", error);
				throw error;
			}
		}, 20000);

		it("should handle V2 streaming object generation", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			
			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			try {
				const result = streamObject({
					model: model,
					schema: z.object({
						title: z.string().describe("Book title"),
						author: z.string().describe("Book author"),
						genre: z.string().describe("Book genre"),
						summary: z.string().describe("Brief book summary"),
						chapters: z.array(z.string()).describe("Chapter titles"),
					}),
					prompt: "Generate a fictional book about space exploration.",
					providerOptions: {
						maxim: {
							traceName: "V2 Stream Object Generation",
							generationName: "Space Book Stream",
							generationTags: {
								output_type: "streaming_object",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				const object = await result.object;
				console.log("OpenAI V2 streaming object result", object);
				expect(object).toBeDefined();
				expect(object.title).toBeDefined();
			} catch (error) {
				console.error("Error in V2 streaming object generation:", error);
				throw error;
			}
		}, 20000);

		it("should handle V2 tool calls with proper logging", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			
			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);
			const traceId = uuid();

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
							traceId: traceId,
							traceName: "V2 Tool Call Test",
							generationName: "Calculator Operations",
							generationTags: {
								tool_usage: "calculator",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				console.log("OpenAI V2 tool call result", result.text);
				expect(result.text).toBeDefined();
			} catch (error) {
				console.error("Error in V2 tool call:", error);
				throw error;
			}
		}, 20000);

		const sessionId = uuid();
		it("should handle V2 session and trace management", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			
			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			try {
				// First call in session
				const result1 = await generateText({
					model: model,
					prompt: "Hello, I'm starting a conversation about cooking.",
					providerOptions: {
						maxim: {
							sessionId: sessionId,
							sessionName: "V2 Cooking Conversation",
							traceName: "Conversation Start",
							sessionTags: {
								topic: "cooking",
								specification: "v2",
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
							sessionName: "V2 Cooking Conversation",
							traceName: "Recipe Request",
							sessionTags: {
								topic: "cooking",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("V2 Session - First response:", result1.text);
				console.log("V2 Session - Second response:", result2.text);
				
				expect(result1.text).toBeDefined();
				expect(result2.text).toBeDefined();
			} catch (error) {
				console.error("Error in V2 session management:", error);
				throw error;
			}
		}, 20000);

		it("should handle V2 multi-modal input with images", async () => {
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
					maxOutputTokens: 300,
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
										"https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg",
									),
								},
							],
						},
					],
					providerOptions: {
						maxim: {
							traceName: "V2 Multi-modal Analysis",
							generationName: "Image Description",
							generationTags: {
								input_type: "multimodal",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				console.log("OpenAI V2 image analysis result", result.text);
				expect(result.text).toBeDefined();
				expect(result.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V2 multi-modal input:", error);
				throw error;
			}
		}, 20000);
	});

	describe("Anthropic V2 Model Tests", () => {
		it("should trace Anthropic model with V2 specification", async () => {
			if (!repoId || !anthropicApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and ANTHROPIC_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			
			const model = wrapMaximAISDKModel(anthropic("claude-3-5-sonnet-20241022"), logger);

			try {
				const response = await generateText({
					model: model,
					temperature: 0.2,
					maxOutputTokens: 150,
					system: "You are a helpful assistant that provides concise answers.",
					prompt: "Explain quantum computing in simple terms.",
					providerOptions: {
						maxim: {
							traceName: "V2 Anthropic Text Generation",
							generationName: "Quantum Computing Explanation",
							generationTags: {
								provider: "anthropic",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				console.log("Anthropic V2 response", response.text);
				expect(response.text).toBeDefined();
				expect(response.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in Anthropic V2 generation:", error);
				throw error;
			}
		}, 20000);

		it("should handle Anthropic V2 streaming", async () => {
			if (!repoId || !anthropicApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and ANTHROPIC_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			
			const model = wrapMaximAISDKModel(anthropic("claude-3-5-sonnet-20241022"), logger);

			try {
				const result = streamText({
					model: model,
					temperature: 0.3,
					maxOutputTokens: 200,
					prompt: "Write a brief story about a robot learning to paint.",
					providerOptions: {
						maxim: {
							traceName: "V2 Anthropic Stream",
							generationName: "Robot Painting Story",
							generationTags: {
								provider: "anthropic",
								specification: "v2",
								content_type: "creative_writing",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				const text = await result.text;
				console.log("Anthropic V2 streaming result", text);
				expect(text).toBeDefined();
				expect(text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in Anthropic V2 streaming:", error);
				throw error;
			}
		}, 20000);
	});

	describe("V2 Error Handling Tests", () => {
		it("should properly handle and log errors in V2 specification", async () => {
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
							traceName: "V2 Error Handling Test",
							generationName: "Invalid Parameters",
							generationTags: {
								test_type: "error_handling",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				// If we reach here, the test should fail
				fail("Expected an error to be thrown");
			} catch (error) {
				console.log("Expected error caught in V2 error handling test:", error);
				expect(error).toBeDefined();
			}
		}, 20000);
	});

	describe("V2 Performance and Edge Cases", () => {
		it("should handle concurrent V2 model calls", async () => {
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
								traceName: `V2 Concurrent Call ${i + 1}`,
								generationName: `Space Fact ${i + 1}`,
								generationTags: {
									call_number: `${i + 1}`,
									specification: "v2",
									test_type: "concurrent",
								},
							} as MaximVercelProviderMetadata,
						},
					})
				);

				const results = await Promise.all(promises);
				
				console.log("V2 Concurrent call results:", results.map(r => r.text));
				expect(results).toHaveLength(3);
				results.forEach(result => {
					expect(result.text).toBeDefined();
					expect(result.text.length).toBeGreaterThan(0);
				});
			} catch (error) {
				console.error("Error in V2 concurrent calls:", error);
				throw error;
			}
		}, 30000);

		it("should handle V2 model with custom span and trace IDs", async () => {
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
							traceName: "V2 Custom IDs Test",
							spanName: "Philosophy Question",
							generationName: "Life Meaning Query",
							generationTags: {
								custom_ids: "true",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				console.log("V2 Custom IDs result", result.text);
				expect(result.text).toBeDefined();
				expect(result.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V2 custom IDs test:", error);
				throw error;
			}
		}, 20000);
	});

	describe("V2-Specific Features", () => {
		it("should handle V2 file content processing", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			
			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			try {
				// Simulate V2 file handling with text content
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
								// Note: In real V2 implementation, this would be a file type
								{
									type: "text",
									text: "File content: This is a sample document about renewable energy sources including solar, wind, and hydroelectric power.",
								},
							],
						},
					],
					providerOptions: {
						maxim: {
							traceName: "V2 File Content Analysis",
							generationName: "Document Summary",
							generationTags: {
								input_type: "file_content",
								specification: "v2",
								content_type: "document",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				console.log("V2 file content analysis result", result.text);
				expect(result.text).toBeDefined();
				expect(result.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V2 file content processing:", error);
				throw error;
			}
		}, 20000);

		it("should handle V2 advanced tool result processing", async () => {
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
											dataPoints: data.length 
										};
									case "median":
										const sorted = [...data].sort((a, b) => a - b);
										const mid = Math.floor(sorted.length / 2);
										return { 
											result: sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid],
											type: "median",
											dataPoints: data.length 
										};
									case "range":
										return { 
											result: Math.max(...data) - Math.min(...data),
											type: "range",
											min: Math.min(...data),
											max: Math.max(...data),
											dataPoints: data.length 
										};
									default:
										return { result: "Analysis type not supported", type: "error" };
								}
							},
						}),
					},
					prompt: "Analyze this dataset: [10, 15, 20, 25, 30, 35, 40] and calculate the mean and range.",
					providerOptions: {
						maxim: {
							traceName: "V2 Advanced Tool Processing",
							generationName: "Data Analysis Tool",
							generationTags: {
								tool_type: "data_analyzer",
								specification: "v2",
								analysis_complexity: "advanced",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				console.log("V2 advanced tool result", result.text);
				expect(result.text).toBeDefined();
				expect(result.text.length).toBeGreaterThan(0);
			} catch (error) {
				console.error("Error in V2 advanced tool processing:", error);
				throw error;
			}
		}, 20000);

		it("should handle V2 complex multi-turn conversation", async () => {
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
							traceName: "V2 Multi-turn Japan Conversation",
							generationName: "Culture Question",
							generationTags: {
								turn: "1",
								topic: "japan_culture",
								specification: "v2",
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
							traceName: "V2 Multi-turn Japan Conversation",
							generationName: "Food Etiquette Question",
							generationTags: {
								turn: "2",
								topic: "food_etiquette",
								specification: "v2",
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
							traceName: "V2 Multi-turn Japan Conversation",
							generationName: "Language Question",
							generationTags: {
								turn: "3",
								topic: "language_learning",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});

				console.log("V2 Multi-turn conversation results:");
				console.log("Turn 1:", turn1.text);
				console.log("Turn 2:", turn2.text);
				console.log("Turn 3:", turn3.text);
				
				expect(turn1.text).toBeDefined();
				expect(turn2.text).toBeDefined();
				expect(turn3.text).toBeDefined();
			} catch (error) {
				console.error("Error in V2 multi-turn conversation:", error);
				throw error;
			}
		}, 30000);

		it("should handle V2 specification version validation", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			
			const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

			// Verify that the wrapped model maintains V2 specification
			expect(model.specificationVersion).toBe("v2");
			expect(model.modelId).toBeDefined();
			expect(model.provider).toBeDefined();

			try {
				const result = await generateText({
					model: model,
					maxOutputTokens: 50,
					prompt: "Hello, this is a V2 specification test.",
					providerOptions: {
						maxim: {
							traceName: "V2 Specification Validation",
							generationName: "Spec Version Test",
							generationTags: {
								test_type: "specification_validation",
								specification: "v2",
							},
						} as MaximVercelProviderMetadata,
					},
				});
				
				console.log("V2 specification validation result", result.text);
				expect(result.text).toBeDefined();
			} catch (error) {
				console.error("Error in V2 specification validation:", error);
				throw error;
			}
		}, 20000);
	});
});
