/**
 * Interactive AUDIO chat with OpenAI Realtime API + Maxim logging + Tool Calling
 *
 * Run with: npx ts-node src/lib/tests/openai/realtime_audio.ts
 *
 * Requirements:
 * - npm install node-record-lpcm16 speaker
 * - sox (macOS: brew install sox)
 * - For macOS: may need to allow microphone access
 */

import { config } from "dotenv";
config();

import * as readline from "readline";
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import { Maxim } from "../../../../index";
import { wrapOpenAIRealtime } from "../../logger/openai/realtime";
import { SessionUpdateEvent } from "openai/resources/realtime/realtime";

// Audio dependencies - wrap in try/catch for helpful error messages
let record: any;
let Speaker: any;

try {
	record = require("node-record-lpcm16");
} catch {
	console.error("❌ Missing dependency: npm install node-record-lpcm16");
	console.error("   Also install sox: brew install sox (macOS) or apt install sox (Linux)");
}

try {
	Speaker = require("speaker");
} catch {
	console.error("❌ Missing dependency: npm install speaker");
}

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
	if (!record || !Speaker) {
		console.error("\n⚠️  Audio dependencies not installed. Install them with:");
		console.error("   npm install node-record-lpcm16 speaker");
		console.error("   brew install sox  (macOS) or apt install sox (Linux)\n");
		process.exit(1);
	}

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
		"maxim-session-name": "Realtime Audio Chat",
		"maxim-session-tags": { mode: "audio", tools: "enabled" },
	});

	let isRecording = false;
	let recordingStream: any = null;
	let speaker: any = null;
	let audioBuffer: Buffer[] = [];

	// Create speaker for playback (24kHz, 16-bit, mono - OpenAI's format)
	function createSpeaker() {
		return new Speaker({
			channels: 1,
			bitDepth: 16,
			sampleRate: 24000,
		});
	}

	rt.socket.on("open", () => {
		rt.send({
			type: "session.update",
			session: {
				type: "realtime",
				output_modalities: ["audio"],
				instructions:
					"You are a helpful voice assistant with access to tools. Use them when appropriate. Keep responses brief and conversational.",
				tools,
				audio: {
					input: {
						transcription: { model: "gpt-4o-mini-transcribe" },
						turn_detection: {
							type: "server_vad",
							threshold: 0.5,
							prefix_padding_ms: 300,
							silence_duration_ms: 500,
						},
					},
					output: {
						voice: "coral",
					},
				},
			},
		} as SessionUpdateEvent);
	});

	rt.on("session.updated", () => {
		console.log("\n🎙️  AUDIO CHAT STARTED");
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log("Commands:");
		console.log("  [r]     - Start/stop recording");
		console.log("  [space] - Push-to-talk (hold)");
		console.log("  [exit]  - Quit");
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log("📦 Tools: get_weather, calculate, get_time\n");
		promptUser();
	});

	// Handle transcription of user's speech
	rt.on("conversation.item.input_audio_transcription.completed", (event: any) => {
		if (event.transcript) {
			// console.log(`\n👤 You said: "${event.transcript}"`);
		}
	});

	// Handle assistant's text response (transcript of audio)
	// rt.on('response.output_audio_transcript.delta', (event: any) => {
	// 	process.stdout.write(event.delta || '');
	// });

	// Handle assistant's audio response
	rt.on("response.output_audio.delta", (event: any) => {
		if (event.delta) {
			const audioData = Buffer.from(event.delta, "base64");
			audioBuffer.push(audioData);
		}
	});

	// Play audio when response is done
	rt.on("response.output_audio.done", () => {
		if (audioBuffer.length > 0) {
			try {
				speaker = createSpeaker();
				const fullAudio = Buffer.concat(audioBuffer);
				speaker.write(fullAudio);
				speaker.end();
			} catch (e) {
				console.error("Audio playback error:", e);
			}
			audioBuffer = [];
		}
	});

	// Handle function calls
	rt.on("response.function_call_arguments.done", (event: any) => {
		const callId = event.call_id;
		const name = event.name;
		let args = {};
		try {
			args = JSON.parse(event.arguments || "{}");
		} catch {
			// ignore
		}

		const result = executeTool(name, args);
		// console.log(`   Result: ${result}`);

		rt.send({
			type: "conversation.item.create",
			item: {
				type: "function_call_output",
				call_id: callId,
				output: result,
			},
		});

		rt.send({ type: "response.create" });
	});

	rt.on("response.done", (event: any) => {
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

	// Start recording microphone
	function startRecording() {
		if (isRecording) return;
		isRecording = true;
		console.log("\n🔴 Recording... (press [r] or release space to stop)");

		try {
			recordingStream = record.record({
				sampleRate: 24000,
				channels: 1,
				audioType: "raw",
				recorder: "sox",
			});

			recordingStream.stream().on("data", (chunk: Buffer) => {
				// Convert to base64 and send to OpenAI
				const base64Audio = chunk.toString("base64");
				rt.send({
					type: "input_audio_buffer.append",
					audio: base64Audio,
				});
			});

			recordingStream.stream().on("error", (err: Error) => {
				console.error("Recording error:", err.message);
				stopRecording();
			});
		} catch (e) {
			console.error("Failed to start recording:", e);
			isRecording = false;
		}
	}

	// Stop recording
	function stopRecording() {
		if (!isRecording) return;
		isRecording = false;
		console.log("⬜ Recording stopped. Processing...");

		if (recordingStream) {
			try {
				recordingStream.stop();
			} catch {
				// ignore
			}
			recordingStream = null;
		}

		// Commit the audio buffer and request response
		rt.send({ type: "input_audio_buffer.commit" });
		rt.send({ type: "response.create" });
		// console.log('\n🤖 Assistant: ');
	}

	function promptUser() {
		rl.question("> ", (input) => {
			const cmd = input.trim().toLowerCase();

			if (cmd === "exit" || cmd === "quit" || cmd === "q") {
				cleanup();
				return;
			}

			if (cmd === "r") {
				if (isRecording) {
					stopRecording();
				} else {
					startRecording();
				}
				promptUser();
				return;
			}

			// If they type text, send as text message
			if (cmd && cmd !== "r") {
				// console.log('\n🤖 Assistant: ');
				rt.send({
					type: "conversation.item.create",
					item: { type: "message", role: "user", content: [{ type: "input_text", text: cmd }] },
				});
				rt.send({ type: "response.create" });
				return;
			}

			promptUser();
		});
	}

	// Handle raw keypress for push-to-talk (space bar)
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
		process.stdin.on("keypress", (_str: string, key: any) => {
			if (key && key.name === "space") {
				if (!isRecording) {
					startRecording();
				}
			}
		});

		process.stdin.on("data", (data: Buffer) => {
			// Space key released (approximation - stop on any key after space)
			if (isRecording && data.toString() !== " ") {
				stopRecording();
			}
		});
	}

	async function cleanup() {
		console.log("\n👋 Goodbye!");

		if (recordingStream) {
			try {
				recordingStream.stop();
			} catch {
				// ignore
			}
		}

		if (speaker) {
			try {
				speaker.end();
			} catch {
				// ignore
			}
		}

		rl.close();
		rt.close();
		wrapper.cleanup();
		await logger?.flush();
		await logger?.cleanup();
		await maxim.cleanup();
		process.exit(0);
	}

	rt.socket.on("close", cleanup);

	// Handle Ctrl+C
	process.on("SIGINT", cleanup);
}

main().catch(console.error);
