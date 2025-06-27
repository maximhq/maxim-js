import { config } from "dotenv";
import { Maxim, MaximVercelProviderMetadata, wrapMaximAISDKModel } from "../../../../index";
import { generateObject, generateText, streamObject, streamText, tool } from "ai"
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { v4 as uuid } from "uuid";
import { z } from 'zod';

config();

let maxim: Maxim;

// local config
const openAIKey = process.env["OPENAI_API_KEY"];
const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
const apiKey = process.env["MAXIM_API_KEY"];
const baseUrl = process.env["MAXIM_BASE_URL"];
const repoId = process.env["MAXIM_LOG_REPO_ID"];

describe("Comprehensive MaximVercelTracer Tests", () => {
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
	
	describe("Basic Chat Model Tests", () => {
		it("should trace OpenAI chat model with basic text and system message", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-3.5-turbo'), logger);
			const traceId = uuid();
			
			const query = "Who is Sachin Tendulkar?";
			try {
				const response = await generateText({
					model: model,
					temperature: 0.3,
					topP: 1,
					frequencyPenalty: 0,
					system: "Be verbose in your answers",
					prompt: query,
					maxTokens: 4096,
					providerOptions: {
						maxim: {
							traceId: traceId,
							traceName: "Testing a new trace for generateText",
							generationName: "Sachin Tendulkar LLM Call",
							generationTags: {
								additional_info: "Generation tag"
							},
							traceTags: {
								testing_tag: "Trace tag"
							}
						} as MaximVercelProviderMetadata,
					}
				});
				console.log("OpenAI response for basic generateText", JSON.stringify(response.response.messages));
			} catch (error) {
				console.error(error);
			}
		}, 20000);

		it("should log the user message and OpenAI chat model response for multiple messages", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4o-mini'), logger);

			try {
				const result = await generateText({
					model: model,
					maxTokens: 1024,
					system: 'You are a helpful chatbot.',
					messages: [
						{
							role: 'user',
							content: 'Hello!',
						},
						{
							role: 'assistant',
							content: 'Hello! How can I help you today?',
						},
						{
							role: 'user',
							content: 'I need help with my computer.',
						},
					],
				});
				console.log("OpenAI response for multiple messages", result.text);
			} catch (error) {
				console.error(error);
			}
		}, 20000)

		it("should log the inputs and outputs for multi turn messages in a single trace", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4-turbo'), logger);

			try {
				const result = await generateText({
					model: model,
					maxTokens: 512,
					messages: [
						{
							role: 'user',
							content: [
								{
									type: 'text',
									text: 'what are the red things in this image?',
								},
								{
									type: 'image',
									image: new URL(
										'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/2024_Solar_Eclipse_Prominences.jpg/720px-2024_Solar_Eclipse_Prominences.jpg',
									),
								},
							],
						},
					],
				});
				console.log("OpenAI response for image prompt", result.text);
			} catch (error) {
				console.error(error);
			}
		}, 20000)

		it("should log the user input image and assistant message for image prompt", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4-turbo'), logger);

			try {
				const result = await generateText({
					model: model,
					maxTokens: 512,
					messages: [
						{
							role: 'user',
							content: [
								{
									type: 'text',
									text: 'what are the red things in this image?',
								},
								{
									type: 'image',
									image: new URL(
										'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/2024_Solar_Eclipse_Prominences.jpg/720px-2024_Solar_Eclipse_Prominences.jpg',
									),
								},
							],
						},
					],
				});
				console.log("OpenAI response for image prompt", result.text);
			} catch (error) {
				console.error(error);
			}
		}, 20000)

		it("should log the user input and the model response for stream text", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4-turbo'), logger);

			try {
				const result = streamText({
					model: model,
					maxTokens: 512,
					temperature: 0.3,
					maxRetries: 5,
					prompt: 'Invent a new holiday and describe its traditions.',
					providerOptions: {
						maxim: {
							traceName: "OpenAI stream"
						}
					}
				});
				console.log("OpenAI response for stream text", result.text);
			} catch (error) {
				console.error(error);
			}
		}, 20000)

		const sessionId = uuid();
		it("should log the user input and the model response for stream text with chat prompt", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4-turbo'), logger);

			try {
				const result = streamText({
					model: model,
					maxTokens: 1024,
					system: 'You are a helpful chatbot.',
					messages: [
						{
							role: 'user',
							content: 'Hello!',
						},
						{
							role: 'assistant',
							content: 'Hello! How can I help you today?',
						},
						{
							role: 'user',
							content: 'I need help with my computer.',
						},
					],
					providerOptions: {
						maxim: {
							traceName: "OpenAI stream",
							sessionId: sessionId,
							sessionName: "Testing a new session"
						} as MaximVercelProviderMetadata
					}
				});
				console.log("OpenAI response for stream text with chat prompt", await result.text);
			} catch (error) {
				console.error("Error in stream text with chat prompt", error);
			}
		}, 20000)

		it("should log the user input and the model response for stream text", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4o-mini'), logger);

			try {
				const result = streamText({
					model: model,
					messages: [
						{
							role: 'user',
							content: [
								{ type: 'text', text: 'Describe the image in detail.' },
								{ type: 'image', image: new URL('https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/2024_Solar_Eclipse_Prominences.jpg/720px-2024_Solar_Eclipse_Prominences.jpg') },
							],
						},
					],
					providerOptions: {
						maxim: {
							traceName: "OpenAI stream",
							sessionId: sessionId,
							sessionName: "Test session",
							sessionTags: {
								test: "Testing tag"
							}
						} as MaximVercelProviderMetadata
					}
				});
				console.log("OpenAI response for image prompt with streamed text", await result.text);
			} catch (error) {
				console.error("Error in image prompt with streamed text", error);
			}
		}, 20000)

		it("should log the user input and the model response for generate object", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4o-mini'), logger);

			try {
				const result = await generateObject({
					model: model,
					schema: z.object({
						recipe: z.object({
							name: z.string(),
							ingredients: z.array(
								z.object({
									name: z.string(),
									amount: z.string(),
								}),
							),
							steps: z.array(z.string()),
						}),
					}),
					prompt: 'Generate a lasagna recipe.',
					providerOptions: {
						maxim: {
							traceName: "OpenAI object"
						}
					}
				});
				console.log("OpenAI response for generate object", result);
			} catch (error) {
				console.error("Error in generate object", error);
			}
		}, 20000)

		it("should log the user input and the model response for generate object", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4o-mini'), logger);
			const traceId = uuid();
			const spanId = uuid();

			try {
				const { text: rawOutput } = await generateText({
					model: model,
					prompt:
						'Predict the top 3 largest city by 2050. For each, return the name, the country, the reason why it will on the list, and the estimated population in millions.',
					providerOptions: {
						maxim: {
							traceId: traceId,
							spanId: spanId,
						}
					}
				});

				const { object } = await generateObject({
					model: model,
					prompt: 'Extract the desired information from this text: \n' + rawOutput,
					schema: z.object({
						name: z.string().describe('the name of the city'),
						country: z.string().describe('the name of the country'),
						reason: z
							.string()
							.describe(
								'the reason why the city will be one of the largest cities by 2050',
							),
						estimatedPopulation: z.number(),
					}),
					output: 'array',
					providerOptions: {
						maxim: {
							traceId: traceId,
							spanId: spanId,
						}
					}
				});
				
				const { text: output } = await generateText({
					model: model,
					prompt: `Format this into a human-readable format: ${JSON.stringify(object)}`,
					providerOptions: {
						maxim: {
							traceId: traceId,
							traceName: "OpenAI object"
						} as MaximVercelProviderMetadata
					}
				});
				console.log("OpenAI response for image prompt with streamed text", output);
			} catch (error) {
				console.error("Error in image prompt with streamed text", error);
			}
		}, 20000)

		it("should log the user input and the model response for stream object", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4o-mini'), logger);

			try {
				const object = streamObject({
					model: model,
					schema: z.object({
						recipe: z.object({
							name: z.string(),
							ingredients: z.array(z.string()),
							steps: z.array(z.string()),
						}),
					}),
					prompt: 'Generate a lasagna recipe.',
					providerOptions: {
						maxim: {
							traceName: "OpenAI object stream"
						}
					}
				});
				console.log("OpenAI response for stream object", object.object);
			} catch (error) {
				console.error("Error in stream object", error);
			}
		}, 20000)

		it("should log the user input and the model response for stream object with image prompt", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4o-mini'), logger);

			try {
				const object = streamObject({
					model: model,
					maxTokens: 512,
					schema: z.object({
						stamps: z.array(
							z.object({
								country: z.string(),
								date: z.string(),
							}),
						),
					}),
					messages: [
						{
							role: 'user',
							content: [
								{
									type: 'text',
									text: 'list all the stamps in these passport pages?',
								},
								{
									type: 'image',
									image: new URL(
										'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/WW2_Spanish_official_passport.jpg/1498px-WW2_Spanish_official_passport.jpg',
									),
								},
							],
						},
					],
					providerOptions: {
						maxim: {
							traceName: "OpenAI object stream"
						}
					}
				});
				console.log("OpenAI response for stream object with image prompt", object.object);
			} catch (error) {
				console.error("Error in stream object with image prompt", error);
			}
		}, 20000)

		it("should call the weather tool and get the weather with openai", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-3.5-turbo'), logger);
			const traceId = uuid();

			try {
				const { text: resText } = await generateText({
					model: model,
					maxSteps: 5,
					tools: {
						weather: tool({
							description: 'Get the weather in a location',
							parameters: z.object({
								location: z.string().describe('The location to get the weather for'),
							}),
							execute: async ({ location }: { location: string }) => ({
								location,
								temperature: 72 + Math.floor(Math.random() * 21) - 10,
							}),
						}),
					},
					providerOptions: {
						maxim: {
							traceName: "Double decker",
							traceId: traceId,
						} as MaximVercelProviderMetadata
					}
				});

				const { text: res2Text } = await generateText({
					model: model,
					maxSteps: 5,
					prompt: `Explain to me some reasons for this: ${resText}`,
					providerOptions: {
						maxim: {
							traceName: "Double decker",
							traceId: traceId,
						}
					}
				});
				console.log("Anthropic response for web search", res2Text);
			} catch (error) {
				console.error("Error in web search", error);
			}
		}, 20000)

		it("should log multiple tool calls done simultaneously", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-4o-mini'), logger);

			try {
				const result = await generateText({
					model: model,
					tools: {
						weather: tool({
							description: 'Get the weather in a location',
							parameters: z.object({
								location: z.string().describe('The location to get the weather for'),
							}),
							execute: async ({ location }: { location: string }) => ({
								location,
								temperature: 72 + Math.floor(Math.random() * 21) - 10,
							}),
						}),
						cityAttractions: tool({
							parameters: z.object({ city: z.string() }),
							execute: async ({ city }: { city: string }) => {
								if (city === 'San Francisco') {
									return {
										attractions: [
											'Golden Gate Bridge',
											'Alcatraz Island',
											"Fisherman's Wharf",
										],
									};
								} else {
									return { attractions: [] };
								}
							},
						}),
					},
					maxSteps: 5,
					prompt: 'What is the weather in San Francisco and what attractions should I visit?',
					providerOptions: {
						maxim: {
							traceName: "Multiple tool calls openai"
						}
					}
				});
				console.log("OpenAI response for multiple tool calls", result.text);
			} catch (error) {
				console.error("Error in multiple tool calls", error);
			}
		}, 20000)

		it("should get a web searcher with openai", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(openai.chat('gpt-3.5-turbo'), logger);

			try {
				const { text, sources } = await generateText({
					model: model,
					prompt: 'What happened in San Francisco last week?',
					tools: {
						web_search_preview: openai.tools.webSearchPreview(),
					},
					maxSteps: 5,
					providerOptions: {
						maxim: {
							traceName: "SF web searcher"
						}
					}  
				});
				console.log("OpenAI response for web search", text);
				console.log("OpenAI sources for web search", sources);
			} catch (error) {
				console.error("Error in web search", error);
			}
		}, 20000)

		it("should trace Anthropic chat model with basic text", async () => {
			if (!repoId || !anthropicApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and ANTHROPIC_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if(!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(anthropic('claude-3-5-sonnet-20241022'), logger);
			
			const query = "Who is Sachin Tendulkar?";
			try {
				const response = await generateText({
					model: model,
					temperature: 0,
					topP: 1,
					frequencyPenalty: 0,
					system: "Be verbose in your answers",
					prompt: query,
					maxTokens: 4096,
					});
					console.log("Anthropic response for basic generateText", response);
				} catch (error) {
					console.error(error);
				}
		}, 20000);

		it("should trace Anthropic chat model with basic text and system message", async () => {
			if (!repoId || !anthropicApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and ANTHROPIC_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if(!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(anthropic('claude-3-5-sonnet-20241022'), logger);
			
			const query = "Who is Sachin Tendulkar?";
			try {
				const response = await generateText({
					model: model,
					temperature: 0,
					topP: 1,
					frequencyPenalty: 0,
					system: "Be verbose in your answers",
					prompt: query,
					maxTokens: 4096,
				});
					console.log("OpenAI response for basic generateText", response);
			} catch (error) {
				console.error(error);
			}
		}, 20000);

		it("should trace Anthropic chat model with basic text with streaming", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if(!logger) {
				throw new Error("Logger is not available");
			}
			const model = wrapMaximAISDKModel(anthropic('claude-3-5-sonnet-20241022'), logger);

			const query = "Who is Sachin Tendulkar?";
			try {
				const response = streamText({
					model: model,
					temperature: 0,
					topP: 1,
					frequencyPenalty: 0,
					system: "Be verbose in your answers",
					prompt: query,
					maxTokens: 4096,
					});
				const res = await response.text;
					console.log("OpenAI response for streaming: ", res);
				} catch (error) {
					console.error(error);
				}
		}, 20000);

	});
});