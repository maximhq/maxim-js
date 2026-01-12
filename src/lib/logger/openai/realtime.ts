import { v4 as uuid } from "uuid";
import type { MaximLogger } from "../logger";
import type { ChatCompletionChoice, ChatCompletionResult, Session, Usage } from "../components";
import type { Attachment } from "../../types";
import type { CompletionRequest } from "../../models/prompt";
import {
	ConversationItemInputAudioTranscriptionCompletedEvent,
	InputAudioBufferAppendEvent,
	RealtimeClientEvent,
	RealtimeErrorEvent,
	RealtimeSessionCreateRequest,
	ResponseCreateEvent,
	ResponseDoneEvent,
	SessionCreatedEvent,
	ResponseFunctionCallArgumentsDeltaEvent,
	ResponseFunctionCallArgumentsDoneEvent,
	SessionUpdatedEvent,
	RealtimeServerEvent,
	ConversationItemAdded,
} from "openai/resources/realtime/realtime";
import { ResponseAudioDeltaEvent } from "openai/resources/responses/responses";

import { ContainerManager, TraceContainer } from "../../models/containers";
import { MaximRealtimeHeaders, RealtimeState } from "./realtime/types";
import { extractMessageContent, extractOutputText, pcm16ToWav } from "./realtime/utils";
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import { AsyncQueue } from "./realtime/queue";

// Re-export types for external use
export type { MaximRealtimeHeaders } from "./realtime/types";

export class MaximOpenAIRealtimeWrapper {
	private state: RealtimeState;
	private boundHandlers: Map<RealtimeServerEvent["type"], (event: any) => void> = new Map();
	private containerManager: ContainerManager = new ContainerManager();
	private eventQueue: AsyncQueue = new AsyncQueue();
	private originalSend: ((event: RealtimeClientEvent) => any) | null = null;
	private modelParametersToIgnore: string[] = [];

	constructor(
		private realtimeClient: OpenAIRealtimeWS,
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
			currentTraceId: null,
			currentGenerationId: null,
			sttGenerationId: null,
			llmGenerationId: null,
			currentGenerationType: null,

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
			toolCallIds: new Set(),
			toolCallOutputs: new Map(),
			pendingToolCallOutputs: new Map(),
			hasPendingToolCalls: false,
			isContinuingTrace: false,

			userAudioBuffer: new Map(),
			pendingUserAudio: Buffer.alloc(0),
			currentItemId: null,

			// Audio input mode flag
			isAudioInput: false,

			// Flag for deferred trace finalization
			pendingTraceFinalization: false,
		};

		this.modelParametersToIgnore = ["model", "instructions", "expires_at", "include", "object", "type", "id", "audio"];

		// Attach event listeners
		this.attachEventListeners();

		// Wrap send method to intercept client events
		this.wrapSendMethod();
	}

	/**
	 * Attach event listeners to the realtime client.
	 */
	private attachEventListeners(): void {
		const events: RealtimeServerEvent["type"][] = [
			"session.created",
			"session.updated",
			"conversation.item.added", // Server sends this when audio buffer is committed (user audio input)
			"conversation.item.created", // Server sends this in response to client's conversation.item.create
			"conversation.item.deleted",
			"response.created",
			"response.function_call_arguments.delta",
			"response.function_call_arguments.done",
			"response.output_audio.delta",
			"response.output_audio.done",
			"response.done",
			"conversation.item.input_audio_transcription.completed",
			"error",
		];

		for (const eventType of events) {
			const handler = (event: any) => this.handleEvent(eventType, event);
			this.boundHandlers.set(eventType, handler);
			this.realtimeClient.on(eventType, handler);
		}
	}

	/**
	 * Wrap the send method to intercept client events like input_audio_buffer.append.
	 */
	private wrapSendMethod(): void {
		const originalSend = this.realtimeClient.send.bind(this.realtimeClient);
		if (!originalSend) return;
		this.originalSend = originalSend;

		this.realtimeClient.send = (event: RealtimeClientEvent) => {
			this.handleClientEvent(event);
			return originalSend(event);
		};
	}

	/**
	 * Handle client events being sent to the server.
	 * Events are queued and processed sequentially to prevent race conditions.
	 */
	private handleClientEvent(event: RealtimeClientEvent): void {
		// Queue the client event handler to ensure sequential processing
		this.eventQueue.enqueue(async () => {
			try {
				switch (event.type) {
					case "input_audio_buffer.append":
						this.handleInputAudioBufferAppend(event);
						break;
					default:
						break;
					// Add other client events as needed
				}
			} catch (e) {
				console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling client event ${event.type}: ${e}`);
			}
		});
	}

	/**
	 * Handle input_audio_buffer.append events to capture user audio.
	 */
	private handleInputAudioBufferAppend(event: InputAudioBufferAppendEvent): void {
		try {
			const audioBytes = Buffer.from(event.audio, "base64");
			this.state.pendingUserAudio = Buffer.concat([this.state.pendingUserAudio, audioBytes]);

			// Mark that this is an audio input conversation
			if (!this.state.isAudioInput) {
				this.state.isAudioInput = true;
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error capturing user audio: ${e}`);
		}
	}

	/**
	 * Handle realtime events and log to Maxim.
	 * Events are queued and processed sequentially to prevent race conditions.
	 */
	private handleEvent(eventType: string, event: any): void {
		// Queue the event handler to ensure sequential processing
		this.eventQueue.enqueue(async () => {
			try {
				switch (eventType) {
					case "session.created":
						this.handleSessionCreated(event);
						break;
					case "session.updated":
						this.handleSessionUpdated(event);
						break;
					case "conversation.item.added":
						this.handleConversationItemAdded(event);
						break;
					case "conversation.item.deleted":
						this.handleConversationItemDeleted();
						break;
					case "response.created":
						this.handleResponseCreated(event);
						break;
					case "response.function_call_arguments.delta":
						this.handleFunctionCallArgumentsDelta(event);
						break;
					case "response.function_call_arguments.done":
						this.handleFunctionCallArgumentsDone(event);
						break;
					case "response.output_audio.delta":
						this.handleResponseOutputAudioDelta(event);
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
		});
	}

	/**
	 * Get or create the session container.
	 */
	private getOrCreateSession(): Session {
		if (!this.state.session) {
			const tags = { ...(this.state.sessionTags ?? {}) };
			this.state.session = this.logger.session({
				id: this.state.sessionId,
				name: this.state.sessionName || "OpenAI Realtime Session",
				tags,
			});
		}
		return this.state.session;
	}

	/**
	 * Get the current trace container.
	 */
	private getCurrentTraceContainer(): TraceContainer | undefined {
		if (!this.state.currentTraceId) return undefined;
		const container = this.containerManager.getContainer(this.state.currentTraceId);
		return container instanceof TraceContainer ? container : undefined;
	}

	/**
	 * Create a new trace for an interaction using ContainerManager.
	 */
	private createTrace(traceId: string): TraceContainer {
		const session = this.getOrCreateSession();
		const traceContainer = new TraceContainer(this.containerManager, this.logger, traceId, "Realtime Interaction", undefined, false);
		traceContainer.create({}, session.id);
		return traceContainer;
	}

	/**
	 * Finalize the trace and clean up state.
	 * This handles ending the trace, session, and resetting all relevant state.
	 */
	private finalizeTrace(traceContainer: TraceContainer | undefined): void {
		// End trace
		if (traceContainer && this.state.currentTraceId) {
			try {
				traceContainer.end();
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

		// Cleanup state
		this.state.currentGenerationId = null;
		this.state.llmGenerationId = null;
		this.state.currentGenerationType = null;
		this.state.currentTraceId = null;
		this.state.hasPendingToolCalls = false;
		this.state.isContinuingTrace = false;
		this.state.toolCallIds.clear();
		this.state.toolCallOutputs.clear();
		this.state.lastUserMessage = null;

		// Clear audio state
		this.state.isAudioInput = false;
		this.state.pendingUserAudio = Buffer.alloc(0);
		this.state.userAudioBuffer.clear();
		this.state.currentItemId = null;
		this.state.outputAudio = null;

		// Clear finalization flag
		this.state.pendingTraceFinalization = false;
	}

	/**
	 * Handle session.created event.
	 */
	private handleSessionCreated(event: SessionCreatedEvent): void {
		try {
			const session = event.session as RealtimeSessionCreateRequest;
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
	private handleSessionUpdated(event: SessionUpdatedEvent): void {
		try {
			const session = event.session as RealtimeSessionCreateRequest;

			if (session) {
				// Update session config
				if (!this.state.sessionConfig) {
					this.state.sessionConfig = { ...session };
				} else {
					for (const [key, value] of Object.entries(session)) {
						if (key === "id") {
							this.state.session?.addTag("sess_id", value);
						}
						if (key !== "id" && value !== null && value !== undefined) {
							this.state.sessionConfig[key] = value;
						}
					}
				}

				const tools = session?.tools;
				if (tools && Array.isArray(tools)) {
					for (const tool of tools) {
						if (tool.type === "function") {
							if (tool.name) {
								this.state.toolsConfig.set(tool.name, {
									name: tool.name,
									description: tool.description || `Function: ${tool.name}`,
								});
							}
						}
					}
				}

				const transcription = session.audio?.input?.transcription;
				// Extract transcription settings
				if (transcription) {
					this.state.transcriptionModel = transcription.model || null;
					this.state.transcriptionLanguage = transcription.language || null;
				}
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling session.updated: ${e}`);
		}
	}

	/**
	 * Handle conversation.item.added event.
	 * - conversation.item.added: Server sends when audio buffer is committed (user speaks)
	 * // Using this event instead of conversation.item.created because this event gets called once after the message is committed,
	 */
	private handleConversationItemAdded(event: ConversationItemAdded): void {
		try {
			const item = event.item;
			if (!item) return;

			if (item.type === "message") {
				const role = item.role;
				if (role !== "user") return;

				// Check if it's audio input
				if (item.content?.length > 0 && item.content[0]?.type === "input_audio") {
					const itemId = item.id;
					this.state.currentItemId = itemId ?? null;
					// Mark that this is audio input
					this.state.isAudioInput = true;

					if (this.state.pendingUserAudio.length > 0 && itemId) {
						this.state.userAudioBuffer.set(itemId, this.state.pendingUserAudio);
						this.state.pendingUserAudio = Buffer.alloc(0);
					}
					return;
				}

				// Extract text message
				this.state.lastUserMessage = extractMessageContent(item);
			} else if (item.type === "function_call_output") {
				const callId = item.call_id;
				const output = item.output;

				if (callId && output !== undefined) {
					const outputStr = typeof output === "string" ? output : String(output);
					this.state.toolCallOutputs.set(callId, outputStr);

					// Use logger directly with tool call ID (container pattern)
					if (this.state.toolCallIds.has(callId)) {
						try {
							this.logger.toolCallResult(callId, outputStr);
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
	private handleResponseCreated(event: ResponseCreateEvent): void {
		try {
			// Ensure session exists
			this.getOrCreateSession();

			// Reset output audio buffer for the new response
			this.state.outputAudio = null;

			// Get current trace container
			let traceContainer = this.getCurrentTraceContainer();

			// Check if we should continue an existing trace (after tool calls)
			if (traceContainer && this.state.hasPendingToolCalls) {
				this.state.hasPendingToolCalls = false;
				this.state.isContinuingTrace = true;
			} else {
				// End previous trace if exists
				if (traceContainer) {
					try {
						traceContainer.end();
					} catch (e) {
						console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error ending previous trace: ${e}`);
					}
				}

				// Create new trace using ContainerManager pattern
				const traceId = uuid();
				traceContainer = this.createTrace(traceId);
				this.state.currentTraceId = traceId;
				this.state.isContinuingTrace = false;
				// Clear generation IDs for new trace
				this.state.sttGenerationId = null;
				this.state.llmGenerationId = null;
			}

			// Extract model parameters from session config
			const modelParameters: Record<string, any> = {};
			if (this.state.sessionConfig) {
				for (const [key, value] of Object.entries(this.state.sessionConfig)) {
					if (!this.modelParametersToIgnore.includes(key) && value !== undefined && value !== null) {
						modelParameters[key] = value;
					}
					if (key === "output_modalities" && value !== undefined && value !== null) {
						if (Array.isArray(value) && value.length > 0) {
							modelParameters["output_modalities"] = value[0];
						}
					}
					if (key === "audio") {
						modelParameters["maxim-audio-model-parameters"] = value;
					}
				}
			}
			this.state.currentModelParameters = modelParameters;

			// For audio input on a NEW trace (not continuation), create 2 generations:
			// 1. STT generation (empty, will be updated when transcription arrives)
			// 2. LLM generation (with system message, model params)
			if (this.state.isAudioInput && !this.state.isContinuingTrace) {
				// Create STT generation (empty - will be updated by transcription handler)
				const sttGenerationId = uuid();
				try {
					traceContainer.addGeneration({
						id: sttGenerationId,
						model: this.state.transcriptionModel || "whisper-1",
						provider: "openai",
						name: "User Speech Transcription",
						modelParameters: this.state.transcriptionLanguage ? { language: this.state.transcriptionLanguage } : {},
						messages: [], // Empty - will be updated when transcription arrives
					});
					this.state.sttGenerationId = sttGenerationId;
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error creating STT generation: ${e}`);
				}

				// Create LLM generation (with system message)
				const llmGenerationId = uuid();
				const llmMessages: CompletionRequest[] = [];

				// Add system message if instructions exist
				if (this.state.sessionConfig?.["instructions"]) {
					llmMessages.push({
						role: "system",
						content: this.state.sessionConfig["instructions"],
					});
				}

				try {
					traceContainer.addGeneration({
						id: llmGenerationId,
						model: this.state.sessionModel || "unknown",
						provider: "openai",
						name: this.state.generationName,
						modelParameters,
						messages: llmMessages,
					});
					this.state.currentGenerationId = llmGenerationId;
					this.state.llmGenerationId = llmGenerationId; // Store for transcription handler
					this.state.currentGenerationType = "llm";
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error creating LLM generation: ${e}`);
				}
			} else {
				// Non-audio input or continuation - create single generation
				const generationId = uuid();
				const messages: CompletionRequest[] = [];

				// Add system message if instructions exist
				if (this.state.sessionConfig?.["instructions"]) {
					messages.push({
						role: "system",
						content: this.state.sessionConfig["instructions"],
					});
				}

				// Handle continuation (after tool calls)
				if (this.state.isContinuingTrace) {
					// Add tool outputs
					if (this.state.toolCallOutputs.size > 0) {
						for (const [callId, output] of this.state.toolCallOutputs.entries()) {
							messages.push({
								role: "tool",
								content: output,
								tool_call_id: callId,
							} as any);
						}
						this.state.toolCallOutputs.clear();
					}

					// Clear lastUserMessage to prevent it from appearing in continuation
					this.state.lastUserMessage = null;
				} else if (this.state.lastUserMessage) {
					// Text input - add user message
					messages.push({
						role: "user",
						content: this.state.lastUserMessage,
					});

					// Set trace input for new trace
					if (traceContainer) {
						try {
							traceContainer.setInput(this.state.lastUserMessage);
						} catch (e) {
							console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error setting trace input: ${e}`);
						}
					}
					this.state.lastUserMessage = null;
				}

				try {
					traceContainer.addGeneration({
						id: generationId,
						model: this.state.sessionModel || "unknown",
						provider: "openai",
						name: this.state.generationName,
						modelParameters,
						messages,
					});
					this.state.currentGenerationId = generationId;
					this.state.currentGenerationType = "llm";
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error creating generation: ${e}`);
				}
			}

			this.state.isContinuingTrace = false;
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling response.created: ${e}`);
		}
	}

	/**
	 * Handle response.output_audio.delta event.
	 */
	private handleResponseOutputAudioDelta(event: ResponseAudioDeltaEvent): void {
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
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling response.output_audio.delta: ${e}`);
		}
	}

	/**
	 * Handle response.function_call_arguments.delta event.
	 */
	private handleFunctionCallArgumentsDelta(event: ResponseFunctionCallArgumentsDeltaEvent): void {
		try {
			const callId = event.item_id;
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
	private handleFunctionCallArgumentsDone(event: ResponseFunctionCallArgumentsDoneEvent): void {
		try {
			// Use call_id to match with function_call_output (not item_id)
			const callId = event.call_id;
			const itemId = event.item_id;
			// Note: The realtime event type doesn't include function name in its type definition,
			// but at runtime it may be present. We'll try to access it and fall back to other methods.
			let functionName: string | undefined = (event as any).name;
			const finalArguments = event.arguments || this.state.functionCallArguments.get(itemId) || "";

			// Try to get function name from arguments if not provided
			if (!functionName) {
				try {
					const argsDict = JSON.parse(finalArguments);
					if (argsDict.name) {
						functionName = argsDict.name;
					}
				} catch {}
			}

			// Fallback name
			if (!functionName) {
				functionName = callId ? `function_${callId.slice(0, 8)}` : "unknown";
			}

			// Get the tool description from config
			const toolConfig = this.state.toolsConfig.get(functionName);
			const description = toolConfig?.description || `Function: ${functionName}`;

			// Create tool call using container pattern
			const traceContainer = this.getCurrentTraceContainer();
			if (traceContainer && callId) {
				try {
					traceContainer.addToolCall({
						id: callId,
						name: functionName,
						description,
						args: finalArguments,
					});
					this.state.toolCallIds.add(callId);
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error creating tool call: ${e}`);
				}
			}

			// Cleanup - use itemId for the arguments map (which was keyed by item_id in delta handler)
			if (itemId) {
				this.state.functionCallArguments.delete(itemId);
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling function call arguments done: ${e}`);
		}
	}

	/**
	 * Handle conversation.item.input_audio_transcription.completed event.
	 * This runs asynchronously - it updates existing generations without blocking the main flow.
	 */
	private handleInputAudioTranscriptionCompleted(event: ConversationItemInputAudioTranscriptionCompletedEvent): void {
		try {
			const transcript = event.transcript || "";
			const itemId = event.item_id;

			// Get user audio for this item
			let userAudio: Buffer | null = null;
			if (itemId && this.state.userAudioBuffer.has(itemId)) {
				userAudio = this.state.userAudioBuffer.get(itemId)!;
			}

			// Update the STT generation if it exists
			if (this.state.sttGenerationId) {
				const sttGenerationId = this.state.sttGenerationId;

				// Add user transcript to the STT generation
				this.logger.generationAddMessage(sttGenerationId, [{ role: "user" as const, content: transcript }]);

				// Attach user audio to STT generation
				if (userAudio && userAudio.length > 0) {
					try {
						const wavBuffer = pcm16ToWav(userAudio);
						const attachment: Attachment = {
							type: "fileData",
							id: uuid(),
							name: "User Audio Input",
							data: wavBuffer,
							mimeType: "audio/wav",
							tags: { "attach-to": "input" },
						};
						this.logger.generationAddAttachment(sttGenerationId, attachment);
					} catch (e) {
						console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error adding user audio to STT generation: ${e}`);
					}
				}

				// Build usage from event
				let usage: Usage | undefined;
				if (event.usage?.type === "tokens") {
					usage = {
						prompt_tokens: event.usage.input_tokens,
						completion_tokens: event.usage.output_tokens,
						total_tokens: event.usage.total_tokens,
					};
				} else {
					usage = {
						prompt_tokens: 0,
						completion_tokens: 0,
						total_tokens: 0,
					};
				}

				// End the STT generation with result
				this.logger.generationResult(sttGenerationId, {
					id: event.event_id || uuid(),
					object: "stt.response",
					created: Math.floor(Date.now() / 1000),
					model: this.state.transcriptionModel || "whisper-1",
					choices: [], // STT has no assistant response
					usage: usage,
				});

				// Explicitly end the STT generation
				this.logger.generationEnd(sttGenerationId);
			}

			// Update the LLM generation if it exists (add user message)
			// Use llmGenerationId (the original LLM generation) instead of currentGenerationId
			// because currentGenerationId may have changed during continuations
			if (this.state.llmGenerationId) {
				// Add user transcript to the LLM generation
				this.logger.generationAddMessage(this.state.llmGenerationId, [{ role: "user" as const, content: transcript }]);

				// Also attach user audio to the LLM generation
				if (userAudio && userAudio.length > 0) {
					try {
						const wavBuffer = pcm16ToWav(userAudio);
						const attachment: Attachment = {
							type: "fileData",
							id: uuid(),
							name: "User Audio Input",
							data: wavBuffer,
							mimeType: "audio/wav",
							tags: { "attach-to": "input" },
						};
						this.logger.generationAddAttachment(this.state.llmGenerationId, attachment);
					} catch (e) {
						console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error adding user audio to LLM generation: ${e}`);
					}
				}
			}

			// Set trace input with the transcript
			if (this.state.currentTraceId) {
				try {
					this.logger.traceInput(this.state.currentTraceId, transcript);

					// Also attach user audio to the trace
					if (userAudio && userAudio.length > 0) {
						try {
							const wavBuffer = pcm16ToWav(userAudio);
							const attachment: Attachment = {
								type: "fileData",
								id: uuid(),
								name: "User Audio Input",
								data: wavBuffer,
								mimeType: "audio/wav",
								tags: { "attach-to": "input" },
							};
							this.logger.traceAddAttachment(this.state.currentTraceId, attachment);
						} catch (e) {
							console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error adding user audio to trace: ${e}`);
						}
					}
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error setting trace input: ${e}`);
				}
			}

			// Cleanup audio buffer for this specific item (transcription-related state only)
			if (itemId) {
				this.state.userAudioBuffer.delete(itemId);
				if (this.state.currentItemId === itemId) {
					this.state.currentItemId = null;
				}
			}

			// Clear sttGenerationId now that we've processed the transcription
			this.state.sttGenerationId = null;

			// If response.done was waiting for us, finalize the trace now
			if (this.state.pendingTraceFinalization) {
				const traceContainer = this.getCurrentTraceContainer();
				this.finalizeTrace(traceContainer);
			}
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error handling input audio transcription completed: ${e}`);
		}
	}

	/**
	 * Handle response.done event.
	 * No longer waits for transcription - processes immediately.
	 * Transcription updates are handled asynchronously in handleInputAudioTranscriptionCompleted.
	 */
	private handleResponseDone(event: ResponseDoneEvent): void {
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
						responseText = extractOutputText(outputItem);
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

			const choices: ChatCompletionChoice[] = [];

			choices.push({
				index: 0,
				message: {
					role: "assistant",
					content: responseText,
					tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
				},
				logprobs: null,
				finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
			});

			// Build result
			const result: ChatCompletionResult = {
				id: responseId,
				object: "realtime.response",
				created: Math.floor(Date.now() / 1000),
				model: this.state.sessionModel || "unknown",
				choices,
				usage: usage !== undefined ? usage : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
			};

			// Log result using logger methods (container pattern)
			if (this.state.currentGenerationId) {
				try {
					this.logger.generationResult(this.state.currentGenerationId, result);
				} catch (e) {
					console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error logging generation result: ${e}`);
				}

				// Attach output audio to generation only (trace inherits from generation)
				if (this.state.outputAudio && this.state.outputAudio.length > 0) {
					try {
						const wavBuffer = pcm16ToWav(this.state.outputAudio);
						const attachment = {
							type: "fileData" as const,
							name: "Assistant Audio Response",
							data: wavBuffer,
							mimeType: "audio/wav",
							tags: { "attach-to": "output" },
						};
						if (this.state.currentTraceId) {
							this.logger.traceAddAttachment(this.state.currentTraceId, {
								id: uuid(),
								...attachment,
							});
						}
						this.logger.generationAddAttachment(this.state.currentGenerationId, {
							id: uuid(),
							...attachment,
						});
					} catch (e) {
						console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error adding output audio attachment: ${e}`);
					}
				} else {
				}
				// Always clear output audio after attempting attachment
				this.state.outputAudio = null;
			}

			// Handle trace ending
			const hasToolCalls = toolCalls.length > 0;
			const traceContainer = this.getCurrentTraceContainer();

			if (hasToolCalls) {
				// Keep trace open for next response
				this.state.hasPendingToolCalls = true;
				// Clear lastUserMessage to prevent it from appearing in continuation generation
				this.state.lastUserMessage = null;
			} else {
				// Set trace output
				if (traceContainer && this.state.currentTraceId && responseText) {
					try {
						this.logger.traceOutput(this.state.currentTraceId, responseText);
					} catch (e) {
						console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error setting trace output: ${e}`);
					}
				}

				// Check if we're still waiting for audio transcription
				const waitingForTranscription = this.state.sttGenerationId !== null;

				if (waitingForTranscription) {
					// Mark that we need to finalize the trace after transcription completes
					this.state.pendingTraceFinalization = true;
				} else {
					// End trace immediately
					this.finalizeTrace(traceContainer);
				}
			}

			// Always clear function call tracking
			this.state.functionCallArguments.clear();
		} catch (e) {
			console.warn(`[MaximSDK][MaximOpenAIRealtimeWrapper] Error processing response.done: ${e}`);
		}
	}

	/**
	 * Handle error event.
	 */
	private handleError(event: RealtimeErrorEvent): void {
		try {
			const errorObj = event.error || event;
			let errorMessage = String(errorObj);

			if (errorObj?.message) {
				errorMessage = String(errorObj.message);
			}

			// Use logger methods for error handling (container pattern)
			if (this.state.currentGenerationId) {
				try {
					this.logger.generationError(this.state.currentGenerationId, {
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
	 * Cleanup and detach event listeners.
	 * Call this when you're done with the wrapper.
	 * Returns a promise that resolves when the queue is drained.
	 */
	public async cleanup(): Promise<void> {
		// Wait for any pending events in the queue to finish processing
		await this.waitForQueueDrain();

		// End any open trace using container pattern
		const traceContainer = this.getCurrentTraceContainer();
		if (traceContainer) {
			try {
				traceContainer.end();
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

		// Restore original send method
		if (this.originalSend) {
			this.realtimeClient.send = this.originalSend;
			this.originalSend = null;
		}
	}

	/**
	 * Wait for the event queue to drain.
	 * Useful for ensuring all pending events are processed before cleanup.
	 */
	public async waitForQueueDrain(): Promise<void> {
		// If queue is idle, return immediately
		if (this.eventQueue.isIdle) {
			return;
		}

		// Otherwise, enqueue a no-op task and wait for it to complete
		// This ensures all prior tasks have finished
		return new Promise<void>((resolve) => {
			this.eventQueue.enqueue(async () => {
				resolve();
			});
		});
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
	realtimeClient: OpenAIRealtimeWS,
	logger: MaximLogger,
	headers?: MaximRealtimeHeaders,
): MaximOpenAIRealtimeWrapper {
	return new MaximOpenAIRealtimeWrapper(realtimeClient, logger, headers);
}
