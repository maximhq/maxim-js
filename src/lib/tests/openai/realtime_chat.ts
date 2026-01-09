/**
 * Interactive chat with OpenAI Realtime API + Maxim logging + Tool Calling
 *
 * Run with: npx ts-node src/lib/tests/openai/realtime_chat.ts
 */

import { config } from "dotenv";
config();

import * as readline from "readline";
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import { Maxim } from "../../../../index";
import { wrapOpenAIRealtime } from "../../logger/openai/realtime";
import { SessionUpdateEvent } from "openai/resources/realtime/realtime";

// Define tools
const tools = [
	{
		type: "function" as const,
		name: "get_weather",
		description: "Get the current weather for a location",
		parameters: {
			type: "object",
			properties: {
				location: { type: "string", description: 'City name, e.g. "San Francisco"' },
				unit: { type: "string", enum: ["celsius", "fahrenheit"], description: "Temperature unit" },
			},
			required: ["location"],
		},
	},
	{
		type: "function" as const,
		name: "calculate",
		description: "Perform a mathematical calculation",
		parameters: {
			type: "object",
			properties: {
				expression: { type: "string", description: 'Math expression to evaluate, e.g. "2 + 2 * 3"' },
			},
			required: ["expression"],
		},
	},
	{
		type: "function" as const,
		name: "get_time",
		description: "Get the current date and time",
		parameters: {
			type: "object",
			properties: {
				timezone: { type: "string", description: 'Timezone, e.g. "America/New_York"' },
			},
		},
	},
];

// Tool implementations
function executeTool(name: string, args: Record<string, any>): string {
	console.log(`\n🔧 Calling tool: ${name}(${JSON.stringify(args)})`);

	switch (name) {
		case "get_weather": {
			const location = args["location"] || "Unknown";
			const unit = args["unit"] || "fahrenheit";
			const temp = unit === "celsius" ? Math.floor(Math.random() * 30 + 5) : Math.floor(Math.random() * 50 + 40);
			const conditions = ["sunny", "cloudy", "rainy", "partly cloudy"][Math.floor(Math.random() * 4)];
			return JSON.stringify({ location, temperature: temp, unit, conditions });
		}
		case "calculate": {
			try {
				// Simple safe eval for basic math
				const expr = String(args["expression"]).replace(/[^0-9+\-*/().% ]/g, "");
				const result = Function(`"use strict"; return (${expr})`)();
				return JSON.stringify({ expression: args["expression"], result });
			} catch {
				return JSON.stringify({ error: "Invalid expression" });
			}
		}
		case "get_time": {
			const tz = args["timezone"] || "UTC";
			try {
				const now = new Date().toLocaleString("en-US", { timeZone: tz });
				return JSON.stringify({ timezone: tz, datetime: now });
			} catch {
				return JSON.stringify({ timezone: "UTC", datetime: new Date().toISOString() });
			}
		}
		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` });
	}
}

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

async function main() {
	const openAIKey = process.env["OPENAI_API_KEY"];
	const maximApiKey = process.env["MAXIM_API_KEY"];
	const repoId = process.env["MAXIM_LOG_REPO_ID"];

	if (!openAIKey || !maximApiKey || !repoId) {
		console.error("Set OPENAI_API_KEY, MAXIM_API_KEY, and MAXIM_LOG_REPO_ID");
		process.exit(1);
	}

	const maxim = new Maxim({ apiKey: maximApiKey, baseUrl: process.env["MAXIM_BASE_URL"] });
	const logger = await maxim.logger({ id: repoId });
	if (!logger) {
		console.error("Failed to create logger");
		process.exit(1);
	}

	const rt = new OpenAIRealtimeWS({ model: "gpt-4o-realtime-preview-2024-12-17" });
	const wrapper = wrapOpenAIRealtime(rt, logger, {
		"maxim-session-name": "Realtime Chat Example",
		"maxim-session-tags": {
			test: "val",
			test2: "val2",
		},
	});

	rt.socket.on("open", () => {
		rt.send({
			type: "session.update",
			session: {
				type: "realtime",
				output_modalities: ["text"],
				instructions: "You are a helpful assistant with access to tools. Use them when appropriate. Be concise.",
				tools,
			},
		} as SessionUpdateEvent);
	});

	rt.on("session.updated", () => {
		console.log('\n💬 Chat started. Type your message and press Enter. Type "exit" to quit.');
		console.log("📦 Available tools: get_weather, calculate, get_time\n");
		promptUser();
	});

	rt.on("response.output_text.delta" as any, (event: any) => {
		process.stdout.write(event.delta);
	});

	// Handle function calls
	rt.on("response.function_call_arguments.done", (event: any) => {
		const callId = event.call_id;
		const name = event.name;
		let args = {};
		try {
			args = JSON.parse(event.arguments || "{}");
		} catch {
			// ignore parse errors
		}

		// Execute the tool
		const result = executeTool(name, args);
		console.log(`   Result: ${result}`);

		// Send result back
		rt.send({
			type: "conversation.item.create",
			item: {
				type: "function_call_output",
				call_id: callId,
				output: result,
			},
		});

		// Request continuation
		rt.send({ type: "response.create" });
	});

	rt.on("response.done", (event: any) => {
		// Check if there were function calls (don't prompt if waiting for tool response)
		const output = event.response?.output || [];
		const hasFunctionCalls = output.some((item: any) => item.type === "function_call");

		if (!hasFunctionCalls) {
			console.log("\n");
			promptUser();
		}
	});

	rt.on("error", (err: any) => {
		console.error("\n❌ Error:", err.message || err);
		promptUser();
	});

	function promptUser() {
		rl.question("You: ", (input) => {
			const text = input.trim();
			if (text.toLowerCase() === "exit") {
				cleanup();
				return;
			}
			if (!text) {
				promptUser();
				return;
			}

			process.stdout.write("Assistant: ");
			rt.send({
				type: "conversation.item.create",
				item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
			});
			rt.send({ type: "response.create" });
		});
	}

	async function cleanup() {
		console.log("\n👋 Goodbye!");
		rl.close();
		rt.close();
		wrapper.cleanup();
		await logger?.flush();
		await logger?.cleanup();
		await maxim.cleanup();
		process.exit(0);
	}

	rt.socket.on("close", cleanup);
}

main().catch(console.error);
