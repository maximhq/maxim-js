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

// Define weather tool that will be called
const getWeatherInfo = tool({
	description: "Get current weather information for a city. Use this tool when the user asks about weather conditions.",
	inputSchema: z.object({
		city: z.string().describe("Name of the city"),
		unit: z.enum(["celsius", "fahrenheit"]).describe("Temperature unit preferred by the user"),
	}),
	execute: async ({ city, unit }) => {
		console.log(`[WEATHER TOOL] 🔧 Executing getWeatherInfo for ${city} in ${unit}`);
		
		// Simulate weather data
		const weatherData = {
			city,
			temperature: unit === "celsius" ? 22 : 72,
			humidity: 65,
			windSpeed: 12,
			conditions: "Partly Cloudy",
			forecast: "Clear skies expected for the next few days",
			lastUpdated: new Date().toISOString(),
			unit,
		};
		
		console.log(`[WEATHER TOOL] ✅ Tool result:`, JSON.stringify(weatherData, null, 2));
		return weatherData;
	},
});

// Main test function
async function main() {
	const { logger } = await initializeMaxim();
	try {
		// Create a session for testing
		const sessionId = uuid();
		const session = logger.session({
			id: sessionId,
			name: "Weather Prediction Test Session",
		});

		// User message asking for weather prediction
		const userMessage = {
			id: uuid(),
			role: "user" as const,
			parts: [{ type: "text" as const, text: "What's the weather like in San Francisco today? Please explain the conditions." }],
		};

		const messages = [userMessage];

		// Validate UI messages
		const validatedMessages = await validateUIMessages({ messages });

		console.log("\n🌤️  Weather Prediction Test");
		console.log("=" .repeat(50));
		console.log("User question:", userMessage.parts[0]?.text);
		console.log("\nExpected flow:");
		console.log("1. Model calls getWeatherInfo tool");
		console.log("2. Tool executes and returns weather data");
		console.log("3. Model receives tool result");
		console.log("4. Model responds with explanation of weather conditions");
		console.log("=" .repeat(50) + "\n");

		// System prompt that encourages tool usage and explanation
		const systemPrompt = `You are a helpful weather assistant. 
When users ask about weather:
1. Always use the getWeatherInfo tool to get current weather data
2. After receiving the tool result, provide a clear, friendly explanation of the weather conditions
3. Include details like temperature, conditions, and any relevant information from the tool response
4. Be conversational and helpful`;

		// Create UI message stream
		const stream = createUIMessageStream({
			execute: async ({ writer: dataStream }) => {
				console.log("[DEBUG] Starting execute function");
				
				// Convert validated messages to model messages
				const modelMessages = convertToModelMessages(validatedMessages, {
					tools: {
						getWeatherInfo,
					},
				});
				console.log("[DEBUG] Converted to model messages:", modelMessages.length, "messages");

				const wrappedModel = wrapMaximAISDKModel(openai("gpt-4o-mini"), logger);

				// Stream text with Maxim integration
				const result = streamText({
					messages: modelMessages,
					tools: {
						getWeatherInfo,
					},
					system: systemPrompt,
					model: wrappedModel,
					providerOptions: {
						maxim: {
							sessionId: sessionId,
							traceTags: {
								environment: process.env["NODE_ENV"] || "test",
								test_type: "weather_prediction",
							},
						} as MaximVercelProviderMetadata,
						openai: {},
					},
				});

				console.log("[DEBUG] streamText called, getting UI message stream");

				// toUIMessageStream() automatically handles tool execution and stream consumption
				const uiStream = result.toUIMessageStream();
				console.log("[DEBUG] Got UI message stream, merging...");
				dataStream.merge(uiStream);
				console.log("[DEBUG] Stream merged");
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
		let toolCallDetected = false;
		let toolResultDetected = false;
		let assistantResponseDetected = false;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				// JsonToSseTransformStream outputs strings directly
				const chunk = typeof value === "string" ? value : new TextDecoder().decode(value);
				streamContent += chunk;
				chunkCount++;

				// Detect tool call
				if (chunk.includes("tool-call") || chunk.includes("getWeatherInfo")) {
					if (!toolCallDetected) {
						console.log("\n✅ [TEST] Tool call detected in stream");
						toolCallDetected = true;
					}
				}

				// Detect tool result
				if (chunk.includes("tool-result") || chunk.includes("temperature") || chunk.includes("conditions")) {
					if (!toolResultDetected && toolCallDetected) {
						console.log("✅ [TEST] Tool result detected in stream");
						toolResultDetected = true;
					}
				}

				// Detect assistant response (text content after tool result)
				if (chunk.includes("text-delta") && toolResultDetected && !assistantResponseDetected) {
					console.log("✅ [TEST] Assistant response detected");
					assistantResponseDetected = true;
				}

				// Log first few chunks and tool-related chunks
				if (chunkCount <= 10) {
					console.log(`[DEBUG] Chunk ${chunkCount}:`, chunk.substring(0, 150));
				} else if (chunk.includes("tool") || chunk.includes("text-delta")) {
					console.log(`[DEBUG] Important chunk ${chunkCount}:`, chunk.substring(0, 200));
				}
			}
		} catch (error) {
			console.error("Error reading stream:", error);
			throw error;
		} finally {
			reader.releaseLock();
		}

		console.log("\n" + "=" .repeat(50));
		console.log("📊 Test Results:");
		console.log("=" .repeat(50));
		console.log(`Total chunks received: ${chunkCount}`);
		console.log(`Total stream length: ${streamContent.length} characters`);
		console.log(`Tool call detected: ${toolCallDetected ? "✅ YES" : "❌ NO"}`);
		console.log(`Tool result detected: ${toolResultDetected ? "✅ YES" : "❌ NO"}`);
		console.log(`Assistant response detected: ${assistantResponseDetected ? "✅ YES" : "❌ NO"}`);
		
		// Extract and display assistant response
		try {
			const responseMatch = streamContent.match(/"text":"([^"]+)"/g);
			if (responseMatch && responseMatch.length > 0) {
				console.log("\n💬 Assistant Response Preview:");
				console.log("-" .repeat(50));
				responseMatch.slice(-3).forEach((match, idx) => {
					const text = JSON.parse(`{${match}}`).text;
					if (text && text.length > 20) {
						console.log(text.substring(0, 200) + "...");
					}
				});
			}
		} catch (e) {
			console.log("\n(Unable to parse response from stream)");
		}

		// Verify test passed
		const testPassed = toolCallDetected && toolResultDetected && assistantResponseDetected;
		console.log("\n" + "=" .repeat(50));
		if (testPassed) {
			console.log("✅ TEST PASSED: Tool was called, executed, and assistant responded!");
		} else {
			console.log("❌ TEST FAILED: Missing required steps");
			if (!toolCallDetected) console.log("   - Tool call was not detected");
			if (!toolResultDetected) console.log("   - Tool result was not detected");
			if (!assistantResponseDetected) console.log("   - Assistant response was not detected");
		}
		console.log("=" .repeat(50) + "\n");

		// End session
		session.end();

		console.log("✅ Test completed!");
		console.log("Note: Check Maxim dashboard to verify the trace contains tool call, tool result, and assistant response.");
	} catch (error) {
		console.error("Error in weather prediction test:", error);
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

