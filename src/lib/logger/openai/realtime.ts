import { v4 as uuid } from "uuid";
import type { MaximLogger } from "../logger";
import type { Generation, Session, Trace, ToolCall } from "../components";
import type { Attachment } from "../../types";
import type { CompletionRequest } from "../../models/prompt";

// Type definitions for OpenAI Realtime API events
// These are based on the OpenAI SDK's realtime types

/**
 * Configuration for custom headers to pass session/generation metadata.
 */
export interface MaximRealtimeHeaders {
	/** Custom session ID to use (if not provided, a new one is created) */
	"maxim-session-id"?: string;
	/** Name for the generation */
	"maxim-generation-name"?: string;
	/** Name for the session */
	"maxim-session-name"?: string;
	/** Tags for the session (JSON string or object) */
	"maxim-session-tags"?: string | Record<string, string>;
}

/**
 * Internal state for tracking realtime connection logging.
 */
interface RealtimeState {
	sessionId: string;
	sessionName: string | undefined;
	sessionTags: Record<string, string> | undefined;
	generationName: string | undefined;
	isLocalSession: boolean;

	// Container references
	session: Session | null;
	currentTrace: Trace | null;
	currentGeneration: Generation | null;
	currentGenerationId: string | null;

	// State tracking
	sessionModel: string | null;
	sessionConfig: Record<string, any> | null;
	systemInstructions: string | null;
	transcriptionModel: string | null;
	transcriptionLanguage: string | null;
	lastUserMessage: string | null;
	outputAudio: Buffer | null;
	currentModelParameters: Record<string, any> | null;

	// Tools configuration (for descriptions)
	toolsConfig: Map<string, { name: string; description: string }>;

	// Function call tracking
	functionCallArguments: Map<string, string>;
	toolCalls: Map<string, ToolCall>;
	toolCallOutputs: Map<string, string>;
	pendingToolCallOutputs: Map<string, string>; // Outputs captured from send()
	hasPendingToolCalls: boolean;
	isContinuingTrace: boolean;

	// Audio tracking
	userAudioBuffer: Map<string, Buffer>;
	pendingUserAudio: Buffer;
	currentItemId: string | null;
}

/**
 * Wrapper for OpenAI Realtime API connections that automatically logs to Maxim.
 *
 * This class intercepts events from the OpenAI Realtime API and logs them to Maxim,
 * creating sessions, traces, and generations for each interaction.
 *
 * @example
 * ```typescript
 * import { OpenAIRealtimeWS } from 'openai/realtime/ws';
 * import { Maxim } from '@maximai/maxim-js';
 * import { MaximOpenAIRealtimeWrapper } from '@maximai/maxim-js/openai';
 *
 * const maxim = new Maxim({ apiKey: process.env.MAXIM_API_KEY });
 * const logger = await maxim.logger({ id: 'my-app' });
 *
 * const rt = new OpenAIRealtimeWS({ model: 'gpt-4o-realtime-preview' });
 * const wrapper = new MaximOpenAIRealtimeWrapper(rt, logger);
 *
 * // Use the realtime connection normally
 * rt.socket.on('open', () => {
 *   rt.send({
 *     type: 'session.update',
 *     session: { modalities: ['text', 'audio'] }
 *   });
 * });
 * ```
 */
export class MaximOpenAIRealtimeWrapper {
	private state: RealtimeState;
	private boundHandlers: Map<string, (event: any) => void> = new Map();

	/**
	 * Creates a new MaximOpenAIRealtimeWrapper.
	 *
	 * @param realtimeClient - The OpenAI Realtime client instance (OpenAIRealtimeWS or OpenAIRealtimeWebSocket)
	 * @param logger - The MaximLogger instance to use for logging
	 * @param headers - Optional headers for session/generation metadata
	 */
	constructor(
		private realtimeClient: any,
		private logger: MaximLogger,
		headers?: MaximRealtimeHeaders,
	) {
		// Parse headers
		const sessionId = headers?.["maxim-session-id"] || uuid();
		const generationName = headers?.["maxim-generation-name"];
		const sessionName = headers?.["maxim-session-name"];
		let sessionTags: Record<string, string> | undefined;

		if (headers?.["maxim-session-tags"]) {
			const tagsRaw = headers["maxim-session-tags"];
			if (typeof tagsRaw === "object") {
				sessionTags = tagsRaw;
			} else if (typeof tagsRaw === "string") {
				try {
					sessionTags = JSON.parse(tagsRaw);
				} catch {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Failed to parse maxim-session-tags as JSON: ${tagsRaw}`);
				}
			}
		}

		// Initialize state
		this.state = {
			sessionId,
			sessionName,
			sessionTags,
			generationName,
			isLocalSession: !headers?.["maxim-session-id"],

			session: null,
			currentTrace: null,
			currentGeneration: null,
			currentGenerationId: null,

			sessionModel: null,
			sessionConfig: null,
			systemInstructions: null,
			transcriptionModel: null,
			transcriptionLanguage: null,
			lastUserMessage: null,
			outputAudio: null,
			currentModelParameters: null,

			toolsConfig: new Map(),

			functionCallArguments: new Map(),
			toolCalls: new Map(),
			toolCallOutputs: new Map(),
			pendingToolCallOutputs: new Map(),
			hasPendingToolCalls: false,
			isContinuingTrace: false,

			userAudioBuffer: new Map(),
			pendingUserAudio: Buffer.alloc(0),
			currentItemId: null,
		};

		// Attach event listeners
		this.attachEventListeners();
	}

	/**
	 * Attach event listeners to the realtime client.
	 */
	private attachEventListeners(): void {
		const events = [
			"session.created",
			"session.updated",
			"conversation.item.created",
			"conversation.item.deleted",
			"response.created",
			"response.text.delta",
			"response.audio.delta",
			"response.audio_transcript.delta",
			"response.function_call_arguments.delta",
			"response.function_call_arguments.done",
			"response.done",
			"conversation.item.input_audio_transcription.completed",
			"error",
		];

		for (const eventType of events) {
			const handler = (event: any) => this.handleEvent(eventType, event);
			this.boundHandlers.set(eventType, handler);
			this.realtimeClient.on(eventType, handler);
		}

		// Handle input audio buffer if the client has it
		this.wrapInputAudioBuffer();

		// Wrap send method to capture outgoing user messages
		this.wrapSendMethod();
	}

	/**
	 * Wrap the send method to capture outgoing user messages and tool outputs.
	 * This ensures we capture data before response.created fires.
	 */
	private wrapSendMethod(): void {
		const originalSend = this.realtimeClient.send?.bind(this.realtimeClient);
		if (!originalSend) return;

		this.realtimeClient.send = (event: any) => {
			// Capture session.update to get tools config
			if (event?.type === "session.update") {
				const tools = event.session?.tools;
				if (Array.isArray(tools)) {
					for (const tool of tools) {
						if (tool?.name) {
							this.state.toolsConfig.set(tool.name, {
								name: tool.name,
								description: tool.description || `Function: ${tool.name}`,
							});
						}
					}
				}
			}

			// Capture user messages when they're sent
			if (event?.type === "conversation.item.create") {
				const item = event.item;
				if (item?.type === "message" && item?.role === "user") {
					const content = item.content;
					if (Array.isArray(content)) {
						const textParts: string[] = [];
						for (const part of content) {
							if (part?.type === "input_text" && part.text) {
								textParts.push(part.text);
							}
						}
						if (textParts.length > 0) {
							this.state.lastUserMessage = textParts.join("");
						}
					}
				}

				// Capture function call outputs when they're sent
				if (item?.type === "function_call_output") {
					const callId = item.call_id;
					const output = item.output;
					if (callId && output !== undefined) {
						const outputStr = typeof output === "string" ? output : JSON.stringify(output);
						this.state.pendingToolCallOutputs.set(callId, outputStr);

						// Also set result on the tool call if it exists
						const toolCall = this.state.toolCalls.get(callId);
						if (toolCall) {
							try {
								toolCall.result(outputStr);
							} catch (e) {
								console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error setting tool call result: ${e}`);
							}
						}
					}
				}
			}
			return originalSend(event);
		};
	}

	/**
	 * Wrap the input_audio_buffer methods to capture user audio.
	 */
	private wrapInputAudioBuffer(): void {
		// Check if the realtime client has input_audio_buffer
		const inputAudioBuffer = this.realtimeClient.inputAudioBuffer || this.realtimeClient.input_audio_buffer;
		if (!inputAudioBuffer) return;

		// Store original methods
		const originalAppend = inputAudioBuffer.append?.bind(inputAudioBuffer);

		if (originalAppend) {
			// Override append to capture audio
			inputAudioBuffer.append = (options: { audio: string }) => {
				try {
					const audioBytes = Buffer.from(options.audio, "base64");
					this.state.pendingUserAudio = Buffer.concat([this.state.pendingUserAudio, audioBytes]);
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error capturing user audio: ${e}`);
				}
				return originalAppend(options);
			};
		}
	}

	/**
	 * Handle realtime events and log to Maxim.
	 */
	private handleEvent(eventType: string, event: any): void {
		try {
			switch (eventType) {
				case "session.created":
					this.handleSessionCreated(event);
					break;
				case "session.updated":
					this.handleSessionUpdated(event);
					break;
				case "conversation.item.created":
					this.handleConversationItemCreated(event);
					break;
				case "conversation.item.deleted":
					this.handleConversationItemDeleted();
					break;
				case "response.created":
					this.handleResponseCreated(event);
					break;
				case "response.audio.delta":
					this.handleResponseAudioDelta(event);
					break;
				case "response.function_call_arguments.delta":
					this.handleFunctionCallArgumentsDelta(event);
					break;
				case "response.function_call_arguments.done":
					this.handleFunctionCallArgumentsDone(event);
					break;
				case "response.done":
					this.handleResponseDone(event);
					break;
				case "conversation.item.input_audio_transcription.completed":
					this.handleInputAudioTranscriptionCompleted(event);
					break;
				case "error":
					this.handleError(event);
					break;
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling event ${eventType}: ${e}`);
		}
	}

	/**
	 * Get or create the session container.
	 */
	private getOrCreateSession(): Session {
		if (!this.state.session) {
			this.state.session = this.logger.session({
				id: this.state.sessionId,
				name: this.state.sessionName || "OpenAI Realtime Session",
				tags: this.state.sessionTags,
			});
		}
		return this.state.session;
	}

	/**
	 * Create a new trace for an interaction.
	 */
	private createTrace(traceId: string): Trace {
		const session = this.getOrCreateSession();
		const trace = session.trace({
			id: traceId,
			name: "Realtime Interaction",
		});
		return trace;
	}

	/**
	 * Handle session.created event.
	 */
	private handleSessionCreated(event: any): void {
		try {
			const session = event.session;
			this.state.systemInstructions = session?.instructions || null;
			this.state.sessionModel = session?.model || null;

			if (session) {
				this.state.sessionConfig = { ...session };
			}

			// Create session container
			this.getOrCreateSession();
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling session.created: ${e}`);
		}
	}

	/**
	 * Handle session.updated event.
	 */
	private handleSessionUpdated(event: any): void {
		try {
			const session = event.session;

			if (session) {
				// Update session config
				if (!this.state.sessionConfig) {
					this.state.sessionConfig = { ...session };
				} else {
					for (const [key, value] of Object.entries(session)) {
						if (value !== null && value !== undefined) {
							this.state.sessionConfig[key] = value;
						}
					}
				}

				// Extract transcription settings
				if (session.input_audio_transcription) {
					this.state.transcriptionModel = session.input_audio_transcription.model || null;
					this.state.transcriptionLanguage = session.input_audio_transcription.language || null;
				}
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling session.updated: ${e}`);
		}
	}

	/**
	 * Handle conversation.item.created event.
	 */
	private handleConversationItemCreated(event: any): void {
		try {
			const item = event.item;
			if (!item) return;

			if (item.type === "message") {
				const role = item.role;
				if (role !== "user") return;

				// Check if it's audio input
				if (item.content?.length > 0 && item.content[0]?.type === "input_audio") {
					const itemId = item.id;
					this.state.currentItemId = itemId;

					if (this.state.pendingUserAudio.length > 0) {
						this.state.userAudioBuffer.set(itemId, this.state.pendingUserAudio);
						this.state.pendingUserAudio = Buffer.alloc(0);
					}
					return;
				}

				// Extract text message
				this.state.lastUserMessage = this.extractMessageContent(item);
			} else if (item.type === "function_call_output") {
				const callId = item.call_id;
				const output = item.output;

				if (callId && output !== undefined) {
					const outputStr = typeof output === "string" ? output : String(output);
					this.state.toolCallOutputs.set(callId, outputStr);

					const toolCall = this.state.toolCalls.get(callId);
					if (toolCall) {
						try {
							toolCall.result(outputStr);
						} catch (e) {
							console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error setting tool call result: ${e}`);
						}
					} else {
						try {
							this.logger.toolCallResult(callId, outputStr);
						} catch (e) {
							console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error setting tool call result via logger: ${e}`);
						}
					}
				}
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling conversation.item.created: ${e}`);
		}
	}

	/**
	 * Handle conversation.item.deleted event.
	 */
	private handleConversationItemDeleted(): void {
		// Clear stale user message reference
		this.state.lastUserMessage = null;
	}

	/**
	 * Handle response.created event.
	 */
	private handleResponseCreated(event: any): void {
		try {
			const response = event.response;

			// Ensure session exists
			this.getOrCreateSession();

			// Check if we should continue an existing trace (after tool calls)
			if (this.state.currentTrace && this.state.hasPendingToolCalls) {
				this.state.hasPendingToolCalls = false;
				this.state.isContinuingTrace = true;
			} else {
				// End previous trace if exists
				if (this.state.currentTrace) {
					try {
						this.state.currentTrace.end();
					} catch (e) {
						console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error ending previous trace: ${e}`);
					}
				}

				// Create new trace
				const traceId = uuid();
				this.state.currentTrace = this.createTrace(traceId);
				this.state.isContinuingTrace = false;
				this.state.pendingUserAudio = Buffer.alloc(0);
			}

			// Create generation
			const generationId = response?.id || uuid();

			// Extract model parameters from session config
			const modelParameters: Record<string, any> = {};
			if (this.state.sessionConfig) {
				for (const [key, value] of Object.entries(this.state.sessionConfig)) {
					if (!["model", "instructions", "modalities"].includes(key)) {
						modelParameters[key] = value;
					}
				}
			}
			this.state.currentModelParameters = modelParameters;

			// Build messages
			const messages: CompletionRequest[] = [];

			// Add system message if instructions exist
			if (this.state.sessionConfig?.["instructions"]) {
				messages.push({
					role: "system",
					content: this.state.sessionConfig["instructions"],
				});
			}

			// Add user message
			if (this.state.lastUserMessage) {
				messages.push({
					role: "user",
					content: this.state.lastUserMessage,
				});

				// Set trace input if this is a new trace
				if (this.state.currentTrace && !this.state.isContinuingTrace) {
					try {
						this.state.currentTrace.input(this.state.lastUserMessage);
					} catch (e) {
						console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error setting trace input: ${e}`);
					}
				}
				this.state.lastUserMessage = null;
			}

			// Add tool call outputs if continuing trace (use pendingToolCallOutputs captured from send())
			if (this.state.isContinuingTrace && this.state.pendingToolCallOutputs.size > 0) {
				for (const [callId, output] of this.state.pendingToolCallOutputs.entries()) {
					// Get the tool name for this call
					const toolCall = this.state.toolCalls.get(callId);
					messages.push({
						role: "tool",
						content: output,
						tool_call_id: callId,
						name: toolCall ? (toolCall as any).name : undefined,
					} as any);
				}
				this.state.pendingToolCallOutputs.clear();
			}

			// Create generation
			try {
				this.state.currentGeneration = this.state.currentTrace!.generation({
					id: generationId,
					model: this.state.sessionModel || "unknown",
					provider: "openai",
					name: this.state.generationName,
					modelParameters,
					messages,
				});
				this.state.currentGenerationId = generationId;
				this.state.isContinuingTrace = false;
			} catch (e) {
				console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error creating generation: ${e}`);
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling response.created: ${e}`);
		}
	}

	/**
	 * Handle response.audio.delta event.
	 */
	private handleResponseAudioDelta(event: any): void {
		try {
			if (event.delta) {
				const audioChunk = Buffer.from(event.delta, "base64");
				if (!this.state.outputAudio) {
					this.state.outputAudio = audioChunk;
				} else {
					this.state.outputAudio = Buffer.concat([this.state.outputAudio, audioChunk]);
				}
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling response.audio.delta: ${e}`);
		}
	}

	/**
	 * Handle response.function_call_arguments.delta event.
	 */
	private handleFunctionCallArgumentsDelta(event: any): void {
		try {
			const callId = event.call_id;
			const delta = event.delta;

			if (callId && delta) {
				const existing = this.state.functionCallArguments.get(callId) || "";
				this.state.functionCallArguments.set(callId, existing + delta);
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling function call arguments delta: ${e}`);
		}
	}

	/**
	 * Handle response.function_call_arguments.done event.
	 */
	private handleFunctionCallArgumentsDone(event: any): void {
		try {
			const callId = event.call_id;
			const itemId = event.item_id;
			let functionName = event.name;
			const finalArguments = event.arguments || this.state.functionCallArguments.get(callId) || "";

			// Try to get function name from arguments if not provided
			if (!functionName) {
				try {
					const argsDict = JSON.parse(finalArguments);
					if (argsDict.name) {
						functionName = argsDict.name;
					}
				} catch {
					// Ignore parsing errors
				}
			}

			// Fallback name
			if (!functionName) {
				functionName = itemId ? `function_${itemId.slice(0, 8)}` : `function_${callId?.slice(0, 8) || "unknown"}`;
			}

			// Get the tool description from config
			const toolConfig = this.state.toolsConfig.get(functionName);
			const description = toolConfig?.description || `Function: ${functionName}`;

			// Create tool call
			if (this.state.currentTrace && callId) {
				try {
					const toolCall = this.state.currentTrace.toolCall({
						id: callId,
						name: functionName,
						description,
						args: finalArguments,
					});
					this.state.toolCalls.set(callId, toolCall);
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error creating tool call: ${e}`);
				}
			}

			// Cleanup
			if (callId) {
				this.state.functionCallArguments.delete(callId);
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling function call arguments done: ${e}`);
		}
	}

	/**
	 * Handle conversation.item.input_audio_transcription.completed event.
	 */
	private handleInputAudioTranscriptionCompleted(event: any): void {
		try {
			if (this.state.currentGenerationId && this.state.currentTrace) {
				const modelParameters = this.state.currentModelParameters || {};
				const transcript = event.transcript || "";

				// End the current generation with STT result
				if (this.state.currentGeneration) {
					this.state.currentGeneration.setModel(this.state.transcriptionModel || "whisper-1");
					this.state.currentGeneration.addMessages([
						{ role: "user" as const, content: transcript },
					]);
					this.state.currentGeneration.setModelParameters({
						language: this.state.transcriptionLanguage,
					});
					// Note: Generation name is set at creation time, we'll use a tag to mark this as STT
					this.state.currentGeneration.addTag("type", "speech-to-text");
					this.state.currentGeneration.result({
						id: event.event_id || uuid(),
						object: "stt.response",
						created: Math.floor(Date.now() / 1000),
						model: this.state.transcriptionModel || "whisper-1",
						choices: [],
						usage: {
							prompt_tokens: event.logprobs?.input_tokens || 0,
							completion_tokens: event.logprobs?.output_tokens || 0,
							total_tokens: event.logprobs?.total_tokens || 0,
						},
					});
				}

				// Attach user audio if available
				const itemId = event.item_id;
				let userAudio: Buffer | null = null;
				if (itemId && this.state.userAudioBuffer.has(itemId)) {
					userAudio = this.state.userAudioBuffer.get(itemId)!;
					if (userAudio && userAudio.length > 0) {
						try {
							const wavBuffer = this.pcm16ToWav(userAudio);
							const attachment: Attachment = {
								type: "fileData",
								id: uuid(),
								name: "User Audio Input",
								data: wavBuffer,
								mimeType: "audio/wav",
								tags: { "attach-to": "input" },
							};
							this.state.currentTrace.addAttachment(attachment);
						} catch (e) {
							console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error adding user audio attachment: ${e}`);
						}
					}
				}

				// Create new generation for the assistant response
				const generationId = uuid();
				try {
					this.state.currentGeneration = this.state.currentTrace.generation({
						id: generationId,
						provider: "openai",
						model: this.state.sessionModel || "unknown",
						name: this.state.generationName,
						modelParameters,
						messages: [{ role: "user" as const, content: transcript }],
					});
					this.state.currentGenerationId = generationId;
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error creating assistant generation: ${e}`);
				}

				// Cleanup audio buffer
				if (itemId) {
					this.state.userAudioBuffer.delete(itemId);
					if (this.state.currentItemId === itemId) {
						this.state.currentItemId = null;
					}
				}
			} else {
				// No current generation - save transcript for later
				this.state.lastUserMessage = event.transcript || "";
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling input audio transcription completed: ${e}`);
		}
	}

	/**
	 * Handle response.done event.
	 */
	private handleResponseDone(event: any): void {
		try {
			const response = event.response;
			const responseId = response?.id || uuid();

			// Extract text and tool calls from output
			let responseText: string | null = null;
			const toolCalls: Array<{
				id: string;
				type: string;
				function: { name: string; arguments: string };
			}> = [];

			const outputItems = response?.output || [];
			for (const outputItem of outputItems) {
				if (outputItem?.type === "message") {
					// Extract text from message content
					if (!responseText) {
						responseText = this.extractOutputText(outputItem);
					}
				} else if (outputItem?.type === "function_call") {
					const callId = outputItem.call_id || outputItem.id || uuid();
					const funcName = outputItem.name || "unknown";
					let args = outputItem.arguments || "";
					if (typeof args !== "string") {
						args = JSON.stringify(args);
					}

					toolCalls.push({
						id: callId,
						type: "function",
						function: {
							name: funcName,
							arguments: args,
						},
					});
				}
			}

			// Extract usage
			let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
			if (response?.usage) {
				usage = {
					prompt_tokens: response.usage.input_tokens || 0,
					completion_tokens: response.usage.output_tokens || 0,
					total_tokens: response.usage.total_tokens || 0,
				};
			}

			// Build result
			const result: any = {
				id: responseId,
				object: "realtime.response",
				created: Math.floor(Date.now() / 1000),
				model: this.state.sessionModel || "unknown",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: responseText,
							tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
						},
						finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
					},
				],
			};

			if (usage) {
				result.usage = usage;
			}

			// Log result
			if (this.state.currentGeneration) {
				try {
					this.state.currentGeneration.result(result);

					// Attach output audio if available
					if (this.state.outputAudio && this.state.outputAudio.length > 0) {
						try {
							const wavBuffer = this.pcm16ToWav(this.state.outputAudio);
							const attachment: Attachment = {
								type: "fileData",
								id: uuid(),
								name: "Assistant Audio Response",
								data: wavBuffer,
								mimeType: "audio/wav",
								tags: { "attach-to": "output" },
							};
							if (this.state.currentTrace) {
								this.state.currentTrace.addAttachment(attachment);
							}
						} catch (e) {
							console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error adding output audio attachment: ${e}`);
						}
						this.state.outputAudio = null;
					}
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error logging generation result: ${e}`);
				}
			}

			// Handle trace ending
			const hasToolCalls = toolCalls.length > 0;
			if (hasToolCalls) {
				// Keep trace open for next response
				this.state.hasPendingToolCalls = true;
			} else {
				// End trace
				if (this.state.currentTrace) {
					try {
						if (responseText) {
							this.state.currentTrace.output(responseText);
						}
						this.state.currentTrace.end();
					} catch (e) {
						console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error ending trace: ${e}`);
					}
				}

				// End session (update timestamp)
				if (this.state.session) {
					try {
						this.state.session.end();
					} catch (e) {
						console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error ending session: ${e}`);
					}
				}

				// Cleanup
				this.state.currentGenerationId = null;
				this.state.currentTrace = null;
				this.state.hasPendingToolCalls = false;
				this.state.isContinuingTrace = false;
				this.state.toolCalls.clear();
				this.state.toolCallOutputs.clear();
				this.state.lastUserMessage = null;
			}

			// Always clear function call tracking
			this.state.functionCallArguments.clear();
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling response.done: ${e}`);
		}
	}

	/**
	 * Handle error event.
	 */
	private handleError(event: any): void {
		try {
			const errorObj = event.error || event;
			let errorMessage = String(errorObj);

			if (errorObj?.message) {
				errorMessage = String(errorObj.message);
			}

			if (this.state.currentGeneration) {
				try {
					this.state.currentGeneration.error({
						message: errorMessage,
						type: errorObj?.type || "RealtimeError",
					});
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error logging generation error: ${e}`);
				}
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling error event: ${e}`);
		}
	}

	/**
	 * Extract message content from a conversation item.
	 */
	private extractMessageContent(item: any): string {
		const content = item.content;
		if (!content) return "";

		if (typeof content === "string") return content;

		if (Array.isArray(content)) {
			const parts: string[] = [];
			for (const contentItem of content) {
				if (typeof contentItem === "string") {
					parts.push(contentItem);
				} else if (contentItem?.type === "input_text") {
					parts.push(contentItem.text || "");
				} else if (contentItem?.type === "input_audio") {
					const transcript = contentItem.transcript;
					if (transcript) {
						parts.push(transcript);
					} else {
						parts.push("[audio]");
					}
				} else if (contentItem?.type === "input_image") {
					parts.push("[image]");
				} else if (contentItem?.type === "input_file") {
					parts.push("[file]");
				}
			}
			return parts.join("");
		}

		return String(content);
	}

	/**
	 * Extract output text from a response message.
	 */
	private extractOutputText(item: any): string {
		const content = item.content;
		if (!content) return "";

		if (typeof content === "string") return content;

		if (Array.isArray(content)) {
			const parts: string[] = [];
			for (const contentItem of content) {
				if (contentItem?.type === "output_text") {
					parts.push(contentItem.text || "");
				} else if (contentItem?.type === "output_audio") {
					parts.push(contentItem.transcript || "");
				}
			}
			return parts.join("");
		}

		return "";
	}

	/**
	 * Convert PCM16 audio data to WAV format.
	 */
	private pcm16ToWav(pcmData: Buffer, sampleRate: number = 24000, channels: number = 1): Buffer {
		const byteRate = sampleRate * channels * 2; // 16-bit = 2 bytes
		const blockAlign = channels * 2;
		const dataSize = pcmData.length;
		const headerSize = 44;
		const fileSize = headerSize + dataSize;

		const buffer = Buffer.alloc(fileSize);

		// RIFF header
		buffer.write("RIFF", 0);
		buffer.writeUInt32LE(fileSize - 8, 4);
		buffer.write("WAVE", 8);

		// fmt subchunk
		buffer.write("fmt ", 12);
		buffer.writeUInt32LE(16, 16); // Subchunk1Size
		buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
		buffer.writeUInt16LE(channels, 22);
		buffer.writeUInt32LE(sampleRate, 24);
		buffer.writeUInt32LE(byteRate, 28);
		buffer.writeUInt16LE(blockAlign, 32);
		buffer.writeUInt16LE(16, 34); // BitsPerSample

		// data subchunk
		buffer.write("data", 36);
		buffer.writeUInt32LE(dataSize, 40);
		pcmData.copy(buffer, 44);

		return buffer;
	}

	/**
	 * Cleanup and detach event listeners.
	 * Call this when you're done with the wrapper.
	 */
	public cleanup(): void {
		// End any open trace/session
		if (this.state.currentTrace) {
			try {
				this.state.currentTrace.end();
			} catch {
				// Ignore
			}
		}

		if (this.state.isLocalSession && this.state.session) {
			try {
				this.state.session.end();
			} catch {
				// Ignore
			}
		}

		// Remove event listeners
		for (const [eventType, handler] of this.boundHandlers) {
			try {
				this.realtimeClient.off(eventType, handler);
			} catch {
				// Ignore - some clients may not support off()
			}
		}
		this.boundHandlers.clear();
	}

	/**
	 * Get the current session ID.
	 */
	public get sessionId(): string {
		return this.state.sessionId;
	}

	/**
	 * Get the underlying realtime client.
	 */
	public get client(): any {
		return this.realtimeClient;
	}
}

/**
 * Helper function to wrap an OpenAI Realtime client with Maxim logging.
 *
 * @param realtimeClient - The OpenAI Realtime client (OpenAIRealtimeWS or OpenAIRealtimeWebSocket)
 * @param logger - The MaximLogger instance
 * @param headers - Optional headers for session/generation metadata
 * @returns A wrapped client that logs to Maxim
 *
 * @example
 * ```typescript
 * import { OpenAIRealtimeWS } from 'openai/realtime/ws';
 * import { Maxim } from '@maximai/maxim-js';
 * import { wrapOpenAIRealtime } from '@maximai/maxim-js/openai';
 *
 * const maxim = new Maxim({ apiKey: process.env.MAXIM_API_KEY });
 * const logger = await maxim.logger({ id: 'my-app' });
 *
 * const rt = new OpenAIRealtimeWS({ model: 'gpt-4o-realtime-preview' });
 * const wrapper = wrapOpenAIRealtime(rt, logger, {
 *   'maxim-session-name': 'Voice Assistant Session'
 * });
 *
 * // Use rt normally - all events are automatically logged
 * ```
 */
export function wrapOpenAIRealtime(
	realtimeClient: any,
	logger: MaximLogger,
	headers?: MaximRealtimeHeaders,
): MaximOpenAIRealtimeWrapper {
	return new MaximOpenAIRealtimeWrapper(realtimeClient, logger, headers);
}

