/**
 * Internal state for tracking realtime connection logging.
 */

import { Session } from "../../components";

export interface RealtimeState {
	sessionId: string;
	sessionName: string | undefined;
	sessionTags: Record<string, string> | undefined;
	generationName: string | undefined;
	isLocalSession: boolean;

	// Container references - using ContainerManager pattern
	session: Session | null;
	currentTraceId: string | null;
	currentGenerationId: string | null;
	// STT generation ID for audio input (created alongside LLM generation)
	sttGenerationId: string | null;
	// LLM generation ID that should receive user message from transcription
	// (separate from currentGenerationId which changes during continuations)
	llmGenerationId: string | null;
	// Track the type of the current generation for proper routing
	currentGenerationType: "stt" | "llm" | null;

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
	toolCallIds: Set<string>; // Track tool call IDs for this trace
	toolCallOutputs: Map<string, string>;
	pendingToolCallOutputs: Map<string, string>; // Outputs captured from send()
	hasPendingToolCalls: boolean;
	isContinuingTrace: boolean;

	// Audio tracking
	userAudioBuffer: Map<string, Buffer>;
	pendingUserAudio: Buffer;
	currentItemId: string | null;

	// Tracks if current interaction is audio input mode
	isAudioInput: boolean;

	// Flag to indicate trace finalization is pending (waiting for transcription)
	pendingTraceFinalization: boolean;
}

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
