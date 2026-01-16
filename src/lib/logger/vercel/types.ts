import type {
	LanguageModelV2CallWarning,
	LanguageModelV2Content,
	LanguageModelV2FinishReason,
	LanguageModelV2ResponseMetadata,
	LanguageModelV2Usage,
	SharedV2Headers,
	SharedV2ProviderMetadata,
} from "ai-sdk-provider-v2";

/**
 * Represents the expected structure of a result from a language model generation call.
 *
 * This interface defines the minimal fields required for converting a generation result into a standardized chat completion result, including token usage and model information.
 *
 * @property usage - Token usage statistics for the generation.
 * @property usage.promptTokens - Number of tokens in the prompt.
 * @property usage.completionTokens - Number of tokens in the completion.
 * @property response - Optional response metadata, including model identifiers.
 * @property response.model_id - The model identifier (snake_case).
 * @property response.modelId - The model identifier (camelCase).
 * @property rawResponse - The raw response object from the model provider.
 */
export interface DoGenerateResultLike {
	usage: {
		promptTokens: number;
		completionTokens: number;
	};
	response?: {
		model_id?: string;
		modelId?: string;
	};
	rawResponse?: any;
}

export type DoGenerateV2Result = {
	content: Array<LanguageModelV2Content>;
	finishReason: LanguageModelV2FinishReason;
	usage: LanguageModelV2Usage;
	providerMetadata?: SharedV2ProviderMetadata;
	request?: {
		body?: unknown;
	};
	response?: LanguageModelV2ResponseMetadata & {
		headers?: SharedV2Headers;
		body?: unknown;
	};
	warnings: Array<LanguageModelV2CallWarning>;
};

export type LanguageFirstTokenModel = {
	received: boolean;
	time: number | null;
};

/**
 * Metadata options for Maxim tracing integration with Vercel AI SDK providers.
 *
 * This type allows you to attach custom metadata to sessions, traces, generations, and spans when using Maxim's tracing/logging features. These fields enable advanced tracking, naming, and tagging of AI model calls for observability and debugging.
 *
 * @property sessionId - Link your traces to a session by specifying its ID.
 * @property sessionName - Override the default session name for this trace.
 * @property sessionTags - Add custom tags to the session for filtering or grouping.
 * @property traceId - Pass in an existing trace's ID to associate this call with a specific trace.
 * @property traceName - Override the default trace name for this call.
 * @property traceTags - Add custom tags to the trace for filtering or grouping.
 * @property generationName - Provide a custom name for the generation (model output) event.
 * @property generationTags - Add custom tags to the generation for filtering or grouping.
 * @property spanId - Pass in a specific span ID to link this call to a particular span.
 * @property spanName - Override the default span name for this call.
 * @property spanTags - Add custom tags to the span for filtering or grouping.
 */
export type MaximVercelProviderMetadata = {
	/** Link your traces to a session */
	sessionId?: string;
	/** Override session name */
	sessionName?: string;
	/** Add tags to session */
	sessionTags?: Record<string, string>;
	/** Pass in an existing trace's id */
	traceId?: string;
	/** Override trace name */
	traceName?: string;
	/** Add tags to trace */
	traceTags?: Record<string, string>;
	/** Pass in a custom generation name */
	generationName?: string;
	/** Add tags to generation */
	generationTags?: Record<string, string>;
	/** Pass in a specific span id */
	spanId?: string;
	/** Override span name */
	spanName?: string;
	/** Add tags to span */
	spanTags?: Record<string, string>;
};
