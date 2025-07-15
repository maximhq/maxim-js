import { config } from "dotenv";
import { Maxim } from "../../../../index";
import { wrapMaximGroqClient } from "../../../../groq-ai-sdk";
import Groq from "groq-sdk";

config();

let maxim: Maxim;

const groqApiKey = process.env['GROQ_API_KEY'] || "";
const apiKey = process.env['MAXIM_API_KEY'] || "";
const baseUrl = process.env['MAXIM_BASE_URL'] || "";
const repoId = process.env['MAXIM_LOG_REPO_ID'] || "";

describe("Comprehensive MaximGroqTracer Tests", () => {
	beforeAll(async () => {
		if (!baseUrl || !apiKey || !repoId || !groqApiKey) {
			throw new Error("MAXIM_BASE_URL, MAXIM_API_KEY, GROQ_API_KEY & LOG_REPO_ID environment variables are required");
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
		it("should trace Groq chat model with basic text and system message", async () => {
			if (!repoId || !groqApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and GROQ_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const client = wrapMaximGroqClient(new Groq({ apiKey: groqApiKey }), logger);

			const query = "Who is Sachin Tendulkar?";
			try {
				const response = await client.chat.completions.create({
					model: "meta-llama/llama-4-scout-17b-16e-instruct",
					temperature: 0.3,
					top_p: 1,
					frequency_penalty: 0,
					messages: [
						{
							role: "user",
							content: query,
						},
					],
					max_tokens: 4096,
				});
				console.log("Groq response for basic generateText", JSON.stringify(response.choices[0].message?.content));
			} catch (error) {
				console.error(error);
			}
		}, 40000);

		  it("should log the user message and Groq chat model response for multiple messages", async () => {
			if (!repoId || !groqApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and GROQ_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const client = wrapMaximGroqClient(new Groq({ apiKey: groqApiKey }), logger);

			try {
				const result = await client.chat.completions.create({
					model: "meta-llama/llama-4-scout-17b-16e-instruct",
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
				console.log("Groq response for multiple messages", result.choices[0].message?.content);
			} catch (error) {
				console.error(error);
			}
		}, 20000);

		it("should log the inputs and outputs for multi turn messages in a single trace", async () => {
			if (!repoId || !groqApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and GROQ_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			  const client = wrapMaximGroqClient(new Groq({ apiKey: groqApiKey }), logger);

			try {
				const result = await client.chat.completions.create({
					model: "meta-llama/llama-4-scout-17b-16e-instruct",
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
				console.log("Groq response for image prompt", result.choices[0].message?.content);
			} catch (error) {
				console.error(error);
			}
		}, 40000);

		it("should log the user input image and assistant message for image prompt", async () => {
			if (!repoId || !groqApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and GROQ_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (!logger) {
				throw new Error("Logger is not available");
			}
			const client = wrapMaximGroqClient(new Groq({ apiKey: groqApiKey }), logger);

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
				console.log("Groq response for image prompt", result.choices[0].message?.content);
			} catch (error) {
				console.error(error);
			}
		}, 40000);
	});
});
