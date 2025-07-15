import { Together } from "together-ai";
import { config } from "dotenv";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { Maxim } from "../../../../index";
import { wrapMaximTogetherClient } from "../../../../together-ai-sdk";

config();

let maxim: Maxim;

const togetherApiKey = process.env['TOGETHER_API_KEY'] || "";
const apiKey = process.env['MAXIM_API_KEY'] || "";
const baseUrl = process.env['MAXIM_BASE_URL'] || "";
const repoId = process.env['MAXIM_LOG_REPO_ID'] || "";

describe("Comprehensive MaximTogetherTracer Tests", () => {
	beforeAll(async () => {
		if (!baseUrl || !apiKey || !repoId || !togetherApiKey) {
			throw new Error("MAXIM_BASE_URL, MAXIM_API_KEY, TOGETHER_API_KEY & LOG_REPO_ID environment variables are required");
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
		it("should trace Together chat model with basic text and system message", async () => {
			if (!repoId || !togetherApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and TOGETHER_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const client = wrapMaximTogetherClient(new Together({ apiKey: togetherApiKey }), logger);

			const query = "Who is Sachin Tendulkar?";
			try {
				const response = await client.completions.create({
					model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
					temperature: 0.3,
					top_p: 1,
					frequency_penalty: 0,
					prompt: query,
					max_tokens: 4096,
				});
				console.log("Together response for basic generateText", JSON.stringify(response.choices[0].text));
			} catch (error) {
				console.error(error);
			}
		}, 40000);

		it("should log the user message and Together chat model response for multiple messages", async () => {
			if (!repoId || !togetherApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and TOGETHER_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const client = wrapMaximTogetherClient(new Together({ apiKey: togetherApiKey }), logger);

			try {
				const result = await client.chat.completions.create({
					model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
					temperature: 0.3,
					top_p: 1,
					frequency_penalty: 0,
					messages: [
						{
							role: "system",
							content: "You are a helpful assistant.",
						},
						{
							role: "user",
							content: "Hello!",
						},
					],
					max_tokens: 4096,
				});
				console.log("Together response for multiple messages", result.choices[0].message?.content);
			} catch (error) {
				console.error(error);
			}
		}, 20000);

		it("should log the inputs and outputs for multi turn messages in a single trace", async () => {
			if (!repoId || !togetherApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and TOGETHER_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const client = wrapMaximTogetherClient(new Together({ apiKey: togetherApiKey }), logger);

			try {
				const result = await client.chat.completions.create({
					model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
					max_tokens: 512,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: "what are the red things in this image?",
								},
								{
									type: "image_url",
									image_url: {
										url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/2024_Solar_Eclipse_Prominences.jpg/720px-2024_Solar_Eclipse_Prominences.jpg",
									},
								},
							],
						},
					],
				});
				console.log("Together response for image prompt", result.choices[0].message?.content);
			} catch (error) {
				console.error(error);
			}
		}, 20000);

		it("should log the user input image and assistant message for image prompt", async () => {
			if (!repoId || !togetherApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and TOGETHER_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const client = wrapMaximTogetherClient(new Together({ apiKey: togetherApiKey }), logger);

			try {
				const result = await client.chat.completions.create({
					model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
					max_tokens: 512,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: "what are the red things in this image?",
								},
								{
									type: "image_url",
									image_url: {
										url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/2024_Solar_Eclipse_Prominences.jpg/720px-2024_Solar_Eclipse_Prominences.jpg",
									},
								},
							],
						},
					],
				});
				console.log("Together response for image prompt", result.choices[0].message?.content);
			} catch (error) {
				console.error(error);
			}
		}, 40000);

		it("should log the user input and the model response for stream text", async () => {
			if (!repoId || !togetherApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and TOGETHER_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const client = wrapMaximTogetherClient(new Together({ apiKey: togetherApiKey }), logger);

			try {
				const result = client.chat.completions.stream({
					model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
					max_tokens: 512,
					temperature: 0.3,
					messages: [
						{
							role: "user",
							content: "Invent a new holiday and describe its traditions.",
						},
					],
				});
				let fullText = "";
				for await (const chunk of result) {
					if (chunk.choices?.[0]?.delta?.content) {
						fullText += chunk.choices[0].delta.content;
					}
				}
				console.log("Together response for stream text", fullText);
			} catch (error) {
				console.error(error);
			}
		}, 40000);

		it("should log the user input and the model response for stream text with chat prompt", async () => {
			if (!repoId || !togetherApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and TOGETHER_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const client = wrapMaximTogetherClient(new Together({ apiKey: togetherApiKey }), logger);

			try {
				const result = await client.chat.completions.stream({
					model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
					max_tokens: 1024,
					temperature: 0.3,
					messages: [
						{
							role: "user",
							content: "Hello!",
						},
						{
							role: "assistant",
							content: "Hello! How can I help you today?",
						},
						{
							role: "user",
							content: "I need help with my computer.",
						},
					],
				});
				let fullText = "";
				for await (const chunk of result) {
					if (chunk.choices?.[0]?.delta?.content) {
						fullText += chunk.choices[0].delta.content;
					}
				}
				console.log("Together response for stream text with chat prompt", fullText);
			} catch (error) {
				console.error("Error in stream text with chat prompt", error);
			}
		}, 40000);

		it("should log the user input and the model response for stream text", async () => {
			if (!repoId || !togetherApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and TOGETHER_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const client = wrapMaximTogetherClient(new Together({ apiKey: togetherApiKey }), logger);

			try {
				const result = await client.chat.completions.stream({
					model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
					max_tokens: 512,
					temperature: 0.3,
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: "Describe the image in detail." },
								{
									type: "image_url",
									image_url: {
										url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/2024_Solar_Eclipse_Prominences.jpg/720px-2024_Solar_Eclipse_Prominences.jpg",
									},
								},
							],
						},
					],
				});
				let fullText = "";
				for await (const chunk of result) {
					if (chunk.choices?.[0]?.delta?.content) {
						fullText += chunk.choices[0].delta.content;
					}
				}
				console.log("Together response for image prompt with streamed text", fullText);
			} catch (error) {
				console.error("Error in image prompt with streamed text", error);
			}
			// }, 20000);

			it("should log the user input and the model response in response_format", async () => {
				if (!repoId || !togetherApiKey) {
					throw new Error("MAXIM_LOG_REPO_ID and TOGETHER_API_KEY environment variables are required");
				}
				const logger = await maxim.logger({ id: repoId });
				if (!logger) {
					throw new Error("Logger is not available");
				}
				const client = wrapMaximTogetherClient(new Together({ apiKey: togetherApiKey }), logger);

				try {
					const result = await client.chat.completions.create({
						model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
						max_tokens: 512,
						temperature: 0.3,
						messages: [
							{
								role: "user",
								content: "Generate a lasagna recipe.",
							},
						],
						response_format: {
							type: "json_object",
						},
					});
					console.log("Together response for generate object", result.choices[0].message?.content);
				} catch (error) {
					console.error("Error in generate object", error);
				}
			}, 20000);

			it("should log Together.ai image generation with Maxim attachments", async () => {
				if (!repoId || !togetherApiKey) {
					throw new Error("MAXIM_LOG_REPO_ID and TOGETHER_API_KEY environment variables are required");
				}
				const logger = await maxim.logger({ id: repoId });
				if (!logger) {
					throw new Error("Logger is not available");
				}
				const client = wrapMaximTogetherClient(new Together({ apiKey: togetherApiKey }), logger);

				try {
					const result = await client.images.create({
						model: "black-forest-labs/FLUX.1-schnell-Free",
						prompt: "A beautiful sunset over a calm ocean",
						n: 1,
					});
					console.log("Together image generation result:", result.data[0]);
				} catch (error) {
					console.error("Error in image generation with Maxim logging:", error);
				}
			}, 40000);

			it("should demonstrate Together.ai chat completion with full Maxim metadata", async () => {
				if (!repoId || !togetherApiKey) {
					throw new Error("MAXIM_LOG_REPO_ID and TOGETHER_API_KEY environment variables are required");
				}
				const logger = await maxim.logger({ id: repoId });
				if (!logger) {
					throw new Error("Logger is not available");
				}
				const client = wrapMaximTogetherClient(new Together({ apiKey: togetherApiKey }), logger);

				try {
					const result = await client.chat.completions.create({
						model: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
						messages: [
							{
								role: "system",
								content: "You are a helpful assistant that provides concise responses.",
							},
							{
								role: "user",
								content: "What is the capital of France?",
							},
						],
						temperature: 0.7,
						max_tokens: 100,
					});

					console.log("Together.ai chat completion result:", result.choices[0]?.message?.content);
				} catch (error) {
					console.error("Error in chat completion with Maxim metadata:", error);
				}
			}, 20000);
		});
	});
});
