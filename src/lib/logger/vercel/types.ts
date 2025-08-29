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
