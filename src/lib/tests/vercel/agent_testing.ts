import { v4 as uuid } from "uuid";
import { generateText, generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod/v3";
import * as dotenv from "dotenv";
import { wrapMaximAISDKModel } from "src/lib/logger/vercel/wrapper";
import { MaximVercelProviderMetadata } from "src/lib/logger/vercel/utils";
import { Maxim } from "src/lib/maxim";
import { Trace } from "src/lib/logger/components";

// Load environment variables
dotenv.config();

// Initialize Maxim SDK
async function initializeMaxim() {
	const apiKey = process.env["MAXIM_API_KEY"];
	const repoId = process.env["MAXIM_LOG_REPO_ID"];
	const baseUrl = process.env["MAXIM_BASE_URL"];
	if (!apiKey || !repoId) {
		throw new Error("MAXIM_API_KEY or MAXIM_LOG_REPO_ID is not defined in the environment variables");
	}

	const maxim = new Maxim({ baseUrl, apiKey, debug: true });
	const logger = await maxim.logger({
		id: repoId,
	});

	if (!logger) {
		throw new Error("Logger is not available");
	}

	return { maxim, logger };
}

// Generate text response
async function generateInitialText(model: any, prompt: string, trace: Trace, spanId: string) {
	const { text: rawOutput } = await generateText({
		model,
		prompt,
		providerOptions: {
			maxim: {
				traceName: "City Prediction",
				traceId: trace.id,
				spanId,
			} as MaximVercelProviderMetadata,
		},
	});

	return rawOutput;
}

// Define the schema for our city data
const CityPredictionSchema = z.object({
	name: z.string().describe("the name of the city"),
	country: z.string().describe("the name of the country"),
	reason: z.string().describe("the reason why the city will be one of the largest cities by 2050"),
	estimatedPopulation: z.number(),
});

// Extract structured data
async function extractStructuredData(model: any, rawOutput: string, trace: Trace, spanId: string) {
	const { object } = await generateObject({
		model,
		prompt: "Extract the desired information from this text: \n" + rawOutput,
		schema: CityPredictionSchema,
		output: "array",
		providerOptions: {
			maxim: {
				traceId: trace.id,
				spanId,
			} as MaximVercelProviderMetadata,
		},
	});

	return object;
}

// Format the final output
async function formatOutput(model: any, object: any, trace: Trace) {
	const { text: output } = await generateText({
		model,
		prompt: `Format this into a human-readable format: ${JSON.stringify(object)}`,
		providerOptions: {
			maxim: {
				traceId: trace.id,
			} as MaximVercelProviderMetadata,
		},
	});

	return output;
}

// Main function
async function main() {
	const { logger } = await initializeMaxim();
	try {

		const model = wrapMaximAISDKModel(google("gemini-2.5-flash"), logger);

		const spanId = uuid();
		const trace = logger.sessionTrace("12fde580-df42-4cca-9d38-85808eb56579", { id: uuid(), name: "City Prediction Demo" });

		const prompt =
			"Predict the top 3 largest city by 2050. For each, return the name, the country, the reason why it will be on the list, and the estimated population in millions.";
		trace.input(prompt);

		// Step 1: Generate initial text response
		const rawOutput = await generateInitialText(model, prompt, trace, spanId);

		// Step 2: Extract structured data
		const structuredData = await extractStructuredData(model, rawOutput, trace, spanId);

		// Step 3: Format the final output
		const formattedOutput = await formatOutput(model, structuredData, trace);

		trace.end();
		logger.sessionEnd("12fde580-df42-4cca-9d38-85808eb56579");
		console.log("Final formatted response:", formattedOutput);
	} catch (error) {
		console.error("Error in city prediction demo:", error);
	} finally {
		await logger.cleanup();
	}
}

// Run the main function
main();
