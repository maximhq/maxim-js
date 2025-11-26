import { v4 as uuid } from "uuid";
import { generateText, stepCountIs, tool } from "ai";
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

// Define calculator tool
const calculator = tool({
	description: "Perform basic arithmetic operations",
	inputSchema: z.object({
		operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The arithmetic operation to perform"),
		a: z.number().describe("First number"),
		b: z.number().describe("Second number"),
	}),
	execute: async ({ operation, a, b }) => {
		console.log(`[CALCULATOR TOOL] 🔧 Executing ${operation}(${a}, ${b})`);
		
		switch (operation) {
			case "add":
				return { result: a + b };
			case "subtract":
				return { result: a - b };
			case "multiply":
				return { result: a * b };
			case "divide":
				if (b === 0) {
					return { result: "Cannot divide by zero", error: true };
				}
				return { result: a / b };
			default:
				return { result: "Invalid operation", error: true };
		}
	},
});

// Define weather tool
const getWeather = tool({
	description: "Get current weather information for a city",
	inputSchema: z.object({
		city: z.string().describe("Name of the city"),
		unit: z.enum(["celsius", "fahrenheit"]).describe("Temperature unit"),
	}),
	execute: async ({ city, unit }) => {
		console.log(`[WEATHER TOOL] 🔧 Getting weather for ${city} in ${unit}`);
		
		// Mock weather data
		const mockWeather = {
			city,
			temperature: unit === "celsius" ? 22 : 72,
			unit,
			condition: "sunny",
			humidity: 65,
		};
		
		return mockWeather;
	},
});

async function main() {
	try {
		const { maxim, logger } = await initializeMaxim();
		const openAIKey = process.env["OPENAI_API_KEY"];
		
		if (!openAIKey) {
			throw new Error("OPENAI_API_KEY is not defined in the environment variables");
		}

		// Wrap the model with Maxim logging
		const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);

		// Test 1: Calculator tool call - Trace 1
		console.log("\n🧮 Test 1: Calculator Tool Call");
		console.log("Prompt: Calculate 15 multiplied by 8, then add 25 to the result.\n");
    
    const session = logger.session({
      id: uuid(),
      name: "Non-Streaming Tool Call Test",
      tags: {
        test_type: "non_streaming_tool_calls",
        model: "gpt-4o-mini",
      },
    });
    
    // const trace1 = session.trace({
    //   id: uuid(),
    //   name: "Calculator Tool Call Test",
    //   tags: {
    //     test_type: "non_streaming_tool_calls",
    //     model: "gpt-4o-mini",
    //   },
    // });
		
		const result1 = await generateText({
			model: model,
			tools: {
				calculator,
			},
			prompt: "Calculate 15 multiplied by 8",
			providerOptions: {
				maxim: {
					sessionId: session.id,
					traceName: "Calculator Tool Call Test",
					generationName: "Calculator Operations",
					generationTags: {
						tool_used: "calculator",
						test_number: "1",
					},
				} as MaximVercelProviderMetadata,
			},
			stopWhen: stepCountIs(5),
		});
    
		console.log("✅ Result:", result1.text);
		console.log("📝 Tool Calls:", result1.toolCalls?.length || 0, "tool call(s)");
		if (result1.toolCalls && result1.toolCalls.length > 0) {
			result1.toolCalls.forEach((tc, idx) => {
				console.log(`   Tool Call ${idx + 1}:`, JSON.stringify(tc, null, 2));
			});
		}
		console.log("\n");

		// Wait a bit between calls
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// // Test 2: Weather tool call - Trace 2
		// console.log("🌤️  Test 2: Weather Tool Call");
		// console.log("Prompt: What's the weather like in San Francisco?\n");
  //   
  //   const trace2 = session.trace({
  //     id: uuid(),
  //     name: "Weather Tool Call Test",
  //     tags: {
  //       test_type: "non_streaming_tool_calls",
  //       model: "gpt-4o-mini",
  //     },
  //   });
		//
		// const result2 = await generateText({
		// 	model: model,
		// 	tools: {
		// 		getWeather,
		// 	},
		// 	prompt: "What's the weather like in San Francisco? Use Celsius.",
		// 	providerOptions: {
		// 		maxim: {
  //         traceId: trace2.id,
		// 			traceName: "Weather Tool Call Test",
		// 			generationName: "Weather Query",
		// 			generationTags: {
		// 				tool_used: "getWeather",
		// 				test_number: "2",
		// 			},
		// 		} as MaximVercelProviderMetadata,
		// 	},
		// 	stopWhen: stepCountIs(5),
		// });
  //   
  //   trace2.end();
		//
		// console.log("✅ Result:", result2.text);
		// console.log("📝 Tool Calls:", result2.toolCalls?.length || 0, "tool call(s)");
		// if (result2.toolCalls && result2.toolCalls.length > 0) {
		// 	result2.toolCalls.forEach((tc, idx) => {
		// 		console.log(`   Tool Call ${idx + 1}:`, JSON.stringify(tc, null, 2));
		// 	});
		// }
		// console.log("\n");
		//
		// // Test 3: Multiple tool calls - Trace 3
		// console.log("🔢 Test 3: Multiple Tool Calls");
		// console.log("Prompt: What's 10 + 5? Also, what's the weather in New York?\n");
  //   
  //   const trace3 = session.trace({
  //     id: uuid(),
  //     name: "Multiple Tool Calls Test",
  //     tags: {
  //       test_type: "non_streaming_tool_calls",
  //       model: "gpt-4o-mini",
  //     },
  //   });
		// 
		// const result3 = await generateText({
		// 	model: model,
		// 	tools: {
		// 		calculator,
		// 		getWeather,
		// 	},
		// 	prompt: "What's 10 + 5? Also, what's the weather in New York?",
		// 	providerOptions: {
		// 		maxim: {
  //         traceId: trace3.id,
		// 			traceName: "Multiple Tool Calls Test",
		// 			generationName: "Multiple Operations",
		// 			generationTags: {
		// 				tool_used: "calculator,getWeather",
		// 				test_number: "3",
		// 			},
		// 		} as MaximVercelProviderMetadata,
		// 	},
		// 	stopWhen: stepCountIs(5),
		// });
		//
		// trace3.end();
		//
		// console.log("✅ Result:", result3.text);
		// console.log("📝 Tool Calls:", result3.toolCalls?.length || 0, "tool call(s)");
		// if (result3.toolCalls && result3.toolCalls.length > 0) {
		// 	result3.toolCalls.forEach((tc, idx) => {
		// 		console.log(`   Tool Call ${idx + 1}:`, JSON.stringify(tc, null, 2));
		// 	});
		// }
		// console.log("\n");

		console.log("✨ All tests completed!");
		console.log("📊 Each test created its own trace automatically.\n");
    session.end();

		// Cleanup
		await maxim.cleanup();
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	}
}

// Run the test
if (require.main === module) {
	main();
}

export { main };
