import { v4 as uuid } from "uuid";
import {
	streamText,
	createUIMessageStream,
	validateUIMessages,
	convertToModelMessages,
	JsonToSseTransformStream,
	tool,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod/v3";
import * as dotenv from "dotenv";
import { wrapMaximAISDKModel } from "src/lib/logger/vercel/wrapper";
import { MaximVercelProviderMetadata } from "src/lib/logger/vercel/utils";
import { Maxim } from "src/lib/maxim";

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

// Define a simple tool for testing
const getWeatherInfo = tool({
	description: "Get current weather information for a city",
	inputSchema: z.object({
		city: z.string().describe("Name of the city"),
		unit: z.enum(["celsius", "fahrenheit"]).describe("Temperature unit"),
	}),
	execute: async ({ city, unit }) => {
		return {
			city,
			temperature: unit === "celsius" ? 18 : 64,
			humidity: 72,
			windSpeed: 15,
			conditions: "Rainy",
			lastUpdated: new Date().toISOString(),
			unit,
		};
	},
});

// Helper function to process a single trace
async function processTrace(
	logger: any,
	sessionId: string,
	conversationHistory: Array<{ id: string; role: "user" | "assistant"; parts: Array<{ type: "text"; text: string }> }>,
	newMessage: { id: string; role: "user"; parts: Array<{ type: "text"; text: string }> },
	traceNumber: number,
): Promise<{ chunkCount: number; streamLength: number }> {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`Trace ${traceNumber}: "${newMessage.parts[0]?.text}"`);
	console.log("=".repeat(60));

	// Combine messages
	const messages = [...conversationHistory, newMessage];

	// Validate UI messages
	const validatedMessages = await validateUIMessages({ messages });

	console.log(`Conversation history: ${conversationHistory.length} messages`);
	console.log(`New message: "${newMessage.parts[0]?.text}"`);

	// System prompt
	const systemPrompt = "You are a helpful weather assistant. When asked about weather, use the getWeatherInfo tool to get current conditions.";

	// Create UI message stream
	const stream = createUIMessageStream({
		execute: async ({ writer: dataStream }) => {
			// Convert validated messages to model messages
			const modelMessages = convertToModelMessages(validatedMessages, {
				tools: {
					getWeatherInfo,
				},
			});

			// Log the model messages being passed to the AI SDK
			console.log(`\n📤 Model Messages for Trace ${traceNumber}:`);
			console.log(JSON.stringify(modelMessages, null, 2));

			const wrappedModel = wrapMaximAISDKModel(openai("gpt-5"), logger);

			// Prepare streamText options
			const streamTextOptions = {
				messages: modelMessages,
				tools: {
					getWeatherInfo,
				},
				system: systemPrompt,
				model: wrappedModel,
				providerOptions: {
					maxim: {
						sessionId: sessionId,
						traceName: `Trace ${traceNumber}: ${newMessage.parts[0]?.text.substring(0, 30)}...`,
						traceTags: {
							trace_number: traceNumber.toString(),
						},
					} as MaximVercelProviderMetadata,
					openai: {},
				},
			};

			// Log the streamText options (excluding the model object)
			console.log(`\n📤 StreamText Options for Trace ${traceNumber}:`);
			console.log(JSON.stringify({
				...streamTextOptions,
				model: `[Model: ${wrappedModel.modelId || 'wrapped'}]`,
			}, null, 2));

			// Stream text with Maxim integration
			const result = streamText(streamTextOptions);

			// toUIMessageStream() automatically handles tool execution and stream consumption
			dataStream.merge(result.toUIMessageStream());
		},
		generateId: () => uuid(),
		originalMessages: validatedMessages,
	});

	// Convert stream to SSE format
	const sseStream = stream.pipeThrough(new JsonToSseTransformStream());

	// Read the stream to verify it works
	const reader = sseStream.getReader();
	let streamContent = "";
	let chunkCount = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			// JsonToSseTransformStream outputs strings directly
			const chunk = typeof value === "string" ? value : new TextDecoder().decode(value);
			streamContent += chunk;
			chunkCount++;

			// Log first few chunks for debugging
			if (chunkCount <= 3) {
				console.log(`  Chunk ${chunkCount}:`, chunk.substring(0, 80));
			}
		}
	} catch (error) {
		console.error(`Error reading stream for trace ${traceNumber}:`, error);
		throw error;
	} finally {
		reader.releaseLock();
	}

	console.log(`  ✅ Trace ${traceNumber} completed: ${chunkCount} chunks, ${streamContent.length} chars`);

	return { chunkCount, streamLength: streamContent.length };
}

// Main test function
async function main() {
	const { logger } = await initializeMaxim();
	try {
		// Create a session for testing
		const sessionId = uuid();
		const session = logger.session({
			id: sessionId,
			name: "UI Message Stream Test Session - Multiple Traces",
		});

		console.log("\n" + "=".repeat(60));
		console.log("UI Message Stream Test - Multiple Traces in Session");
		console.log("=".repeat(60));
		console.log(`Session ID: ${sessionId}`);
		console.log("\nThis test creates multiple traces in the same session,");
		console.log("each with different user inputs, to verify trace isolation.");

		// Build conversation history incrementally
		let conversationHistory: Array<{ id: string; role: "user" | "assistant"; parts: Array<{ type: "text"; text: string }> }> = [];

		// Trace 1: Initial greeting
		const trace1Message = {
			id: uuid(),
			role: "user" as const,
			parts: [{ type: "text" as const, text: "Hello, how are you?" }],
		};
		const trace1Result = await processTrace(logger, sessionId, conversationHistory, trace1Message, 1);
		
		// Update conversation history with trace 1
		conversationHistory.push(trace1Message);
		conversationHistory.push({
			id: uuid(),
			role: "assistant" as const,
			parts: [{ type: "text" as const, text: "I'm doing well, thank you! How can I help you today?" }],
		});

		// Trace 2: Weather question for San Francisco
		const trace2Message = {
			id: uuid(),
			role: "user" as const,
			parts: [{ type: "text" as const, text: "What's the weather in San Francisco?" }],
		};
		const trace2Result = await processTrace(logger, sessionId, conversationHistory, trace2Message, 2);
		
		// Update conversation history with trace 2
		conversationHistory.push(trace2Message);
		conversationHistory.push({
			id: uuid(),
			role: "assistant" as const,
			parts: [{ type: "text" as const, text: "The weather in San Francisco is currently rainy with a temperature of 18°C." }],
		});

		// Summary
		console.log("\n" + "=".repeat(60));
		console.log("Test Summary");
		console.log("=".repeat(60));
		console.log(`Total traces created: 2`);
		console.log(`Trace 1 chunks: ${trace1Result.chunkCount}, length: ${trace1Result.streamLength}`);
		console.log(`Trace 2 chunks: ${trace2Result.chunkCount}, length: ${trace2Result.streamLength}`);

		// End session
		session.end();
		await logger.cleanup();

		console.log("\n✅ Test completed successfully!");
		console.log("\n📊 Verification Checklist:");
		console.log("  ✓ Check Maxim dashboard - session should contain 2 traces");
		console.log("  ✓ Each trace should have its own unique input:");
		console.log("    - Trace 1: 'Hello, how are you?'");
		console.log("    - Trace 2: 'What's the weather in San Francisco?'");
		console.log("  ✓ Verify that traces do NOT show duplicate inputs");
		console.log("  ✓ Each trace should only contain its own user message, not previous ones");
	} catch (error) {
		console.error("Error in UI message stream test:", error);
		throw error;
	} finally {
		await logger.cleanup();
	}
}

// Run the test
main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});

