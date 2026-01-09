/**
 * Example: Text conversation with OpenAI Realtime API + Maxim logging
 *
 * Run with: npx ts-node src/lib/tests/openai/realtime_ex.ts
 *
 * Requires:
 * - OPENAI_API_KEY environment variable
 * - MAXIM_API_KEY environment variable
 * - MAXIM_LOG_REPO_ID environment variable
 * - ws package: npm install ws @types/ws
 */

import { config } from "dotenv";
config();

// Use OpenAIRealtimeWS for Node.js (requires 'ws' package)
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import { Maxim } from "../../../../index";
import { wrapOpenAIRealtime } from "../../logger/openai/realtime";
import { SessionUpdateEvent } from "openai/resources/realtime/realtime";

async function main() {
	const openAIKey = process.env["OPENAI_API_KEY"];
	const maximApiKey = process.env["MAXIM_API_KEY"];
	const repoId = process.env["MAXIM_LOG_REPO_ID"];

	if (!openAIKey || !maximApiKey || !repoId) {
		console.error("Missing required environment variables:");
		console.error("- OPENAI_API_KEY");
		console.error("- MAXIM_API_KEY");
		console.error("- MAXIM_LOG_REPO_ID");
		process.exit(1);
	}

	// Initialize Maxim
	const maxim = new Maxim({
		apiKey: maximApiKey,
		baseUrl: process.env["MAXIM_BASE_URL"],
	});

	const logger = await maxim.logger({ id: repoId });
	if (!logger) {
		console.error("Failed to create logger");
		process.exit(1);
	}

	console.log("🚀 Starting OpenAI Realtime text conversation...\n");

	// Create the realtime client
	const rt = new OpenAIRealtimeWS({
		model: "gpt-4o-realtime-preview-2024-12-17",
	});

	// Wrap with Maxim logging
	const wrapper = wrapOpenAIRealtime(rt, logger, {
		"maxim-session-name": "Realtime Text Chat Example",
		"maxim-generation-name": "realtime-text-generation",
	});

	console.log(`📝 Session ID: ${wrapper.sessionId}\n`);

	// Track conversation state
	let responseComplete = false;

	// Handle socket connection
	rt.socket.on("open", () => {
		console.log("✅ WebSocket connection opened\n");

		// Configure session for text-only modality
		rt.send({
			type: "session.update",
			session: {
				type: "realtime", // Required: 'realtime' for conversation sessions
				output_modalities: ["text"], // Use 'output_modalities' for response format
				model: "gpt-4o-realtime-preview-2024-12-17",
				instructions: "You are a helpful assistant. Keep responses concise and informative.",
			},
		} as SessionUpdateEvent);
	});

	// Handle session created
	rt.on("session.created", (event: any) => {
		console.log("📋 Session created:", event.session?.id);
		console.log("   Model:", event.session?.model);
		console.log("");

		// Send the first user message
		sendUserMessage("Hello! What are the three laws of robotics?");
	});

	// Handle session updated
	rt.on("session.updated", (event: any) => {
		console.log("📋 Session configured");
		console.log("   Modalities:", event.session?.modalities?.join(", "));
		console.log("");
	});

	// Handle text response deltas (streaming text)
	rt.on("response.output_text.delta" as any, (event: any) => {
		process.stdout.write(event.delta);
	});

	// Handle text response complete
	rt.on("response.output_text.done" as any, (_event: any) => {
		console.log("\n");
		console.log("─".repeat(50));
	});

	// Handle response completion
	rt.on("response.done", (event) => {
		const response = event.response;
		console.log("\n📊 Response stats:");
		if (response.usage) {
			console.log(`   Input tokens: ${response.usage.input_tokens}`);
			console.log(`   Output tokens: ${response.usage.output_tokens}`);
			console.log(`   Total tokens: ${response.usage.total_tokens}`);
		}
		console.log("");

		// Check if this was the second response (follow-up)
		if (responseComplete) {
			// End the conversation
			console.log("👋 Conversation complete. Closing connection...\n");
			setTimeout(() => {
				rt.close();
			}, 100);
		} else {
			responseComplete = true;
			// Send a follow-up message
			setTimeout(() => {
				sendUserMessage("Interesting! Who created these laws?");
			}, 500);
		}
	});

	// Handle errors
	rt.on("error", (err) => {
		console.error("❌ Error:", err.message || err);
	});

	// Handle socket close
	rt.socket.on("close", async () => {
		console.log("🔌 Connection closed");

		// Cleanup
		wrapper.cleanup();
		await logger.flush();
		await logger.cleanup();
		await maxim.cleanup();

		console.log("✨ Logs sent to Maxim. Check your dashboard!");
		process.exit(0);
	});

	// Handle socket errors
	rt.socket.on("error", (err) => {
		console.error("❌ Socket error:", err);
	});

	// Helper function to send user messages
	function sendUserMessage(text: string) {
		console.log(`👤 User: ${text}\n`);
		console.log("🤖 Assistant: ");

		rt.send({
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text }],
			},
		});

		rt.send({ type: "response.create" });
	}
}

// Run the example
main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
