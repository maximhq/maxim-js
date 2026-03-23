import { LanguageModelV1CallOptions, LanguageModelV1ProviderMetadata } from "ai-sdk-provider-v1";
import { LanguageModelV2CallOptions, LanguageModelV2ToolResultOutput, SharedV2ProviderOptions } from "ai-sdk-provider-v2";
import { LanguageModelV3CallOptions, LanguageModelV3ToolResultOutput, SharedV3ProviderOptions } from "ai-sdk-provider-v3";
import { v4 as uuid } from "uuid";
import { MaximVercelProviderMetadata } from "./types";

/**
 * Determines the provider type from a given model string.
 *
 * This function inspects the model identifier and returns a type-safe provider name (such as 'openai', 'bedrock', 'anthropic', etc.) based on known substrings in the model name.
 * If no known provider is found, it defaults to 'openai'.
 *
 * @param model - The model identifier string to inspect.
 * @returns The detected provider name.
 */
export function determineProvider(
	model: string,
): "openai" | "bedrock" | "anthropic" | "huggingface" | "azure" | "together" | "groq" | "google" | "elevenlabs" {
	const mapper = (param: string) => {
		if (param.includes("azure")) return "azure";
		if (param.includes("azure_openai")) return "azure";
		if (param.includes("amazon_bedrock")) return "bedrock";
		if (param.includes("bedrock")) return "bedrock";
		if (param.includes("huggingface")) return "huggingface";
		if (param.includes("together")) return "together";
		if (param.includes("openai")) return "openai";
		if (param.includes("anthropic")) return "anthropic";
		if (param.includes("google")) return "google";
		if (param.includes("groq")) return "groq";
		if (param.includes("elevenlabs")) return "elevenlabs";

		return null;
	};

	const provider = mapper(model);

	if (provider !== null) {
		return provider;
	}

	return "openai";
}

/**
 * Extracts supported model parameters from the given language model call options.
 *
 * This function pulls out relevant generation parameters (such as temperature, maxTokens, penalties, etc.) from the provided LanguageModelV1CallOptions object, returning them in a plain object for downstream use.
 *
 * @param options - The call options containing model parameters.
 * @returns An object containing the extracted model parameters, including temperature, maxTokens, topP, topK, frequencyPenalty, stopSequences, seed, headers, presencePenalty, abortSignal, and responseFormat.
 */
export function extractModelParameters(options: LanguageModelV1CallOptions | LanguageModelV2CallOptions | LanguageModelV3CallOptions) {
	const params = {
		temperature: options.temperature,
		topP: options.topP,
		topK: options.topK,
		frequencyPenalty: options.frequencyPenalty,
		stopSequences: options.stopSequences,
		seed: options.seed,
		headers: options.headers,
		presencePenalty: options.presencePenalty,
		abortSignal: options.abortSignal,
		responseFormat: options.responseFormat,
	};
	return params;
}

/**
 * Extracts Maxim-specific provider metadata from the given language model call options.
 *
 * This function retrieves the `maxim` metadata object from the `providerMetadata` field of the options, for advanced tracing and logging in Maxim's observability system.
 *
 * @param options - The call options containing provider metadata.
 * @returns The extracted Maxim metadata with a guaranteed `spanId`, or undefined if not present.
 */
export function extractMaximMetadataFromOptions(
	metadata: LanguageModelV1ProviderMetadata | SharedV2ProviderOptions | SharedV3ProviderOptions | undefined,
) {
	if (!metadata || !metadata["maxim"]) return undefined;
	const maximMetadata = metadata["maxim"] as MaximVercelProviderMetadata;
	return {
		...maximMetadata,
		spanId: maximMetadata.spanId ?? uuid(),
	} as MaximVercelProviderMetadata;
}

/**
 * Extracts structured error information from any thrown value.
 *
 * Handles standard Error objects, API error objects (with code/type fields),
 * plain strings, and unknown values — so generation.error() always receives
 * a meaningful message instead of an empty object.
 *
 * @param error - The caught value from a catch block.
 * @returns An object with message, and optionally code and type.
 */
export function extractErrorInfo(error: unknown): { message: string; code?: string; type?: string } {
	if (error instanceof Error) {
		return {
			message: error.message,
			type: error.name !== "Error" ? error.name : undefined,
			code: (error as unknown as Record<string, unknown>)["code"] as string | undefined,
		};
	}
	if (typeof error === "string") {
		return { message: error };
	}
	if (typeof error === "object" && error !== null) {
		const err = error as Record<string, unknown>;
		let message: string;
		if (typeof err["message"] === "string") {
			message = err["message"];
		} else {
			try {
				message = JSON.stringify(error);
			} catch {
				message = err["message"] !== undefined ? String(err["message"]) : String(error);
			}
		}
		return {
			message,
			code: typeof err["code"] === "string" ? err["code"] : undefined,
			type: typeof err["type"] === "string" ? err["type"] : undefined,
		};
	}
	return { message: String(error) };
}

export function parseToolResultOutput(content: LanguageModelV2ToolResultOutput | LanguageModelV3ToolResultOutput): string {
	switch (content.type) {
		case "text":
		case "error-text":
			return content.value;
		case "json":
		case "error-json":
		case "content":
			return JSON.stringify(content.value);
		default:
			throw new Error(`Unknown tool result type: ${content}`);
	}
}
