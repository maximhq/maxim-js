import { LanguageModelV1 } from "ai-sdk-provider-v1";
import { LanguageModelV2 } from "ai-sdk-provider-v2";
import { LanguageModelV3 } from "ai-sdk-provider-v3";
import { LanguageModelV4 } from "ai-sdk-provider-v4";
import { MaximLogger } from "../logger";
import { MaximAISDKWrapper } from "./v1/wrapper";
import { MaximAISDKWrapperV2 } from "./v2/wrapperV2";
import { MaximAISDKWrapperV3 } from "./v3/wrapperV3";
import { MaximAISDKWrapperV4 } from "./v4/wrapperV4";

export { withMaximLambdaHandler } from "./lambda";

/**
 * Wraps a Vercel AI SDK language model (v1, v2, or v3) with Maxim logging and tracing capabilities.
 *
 * This function routes the provided model based on its specification version (v1, v2, or v3),
 * and returns a wrapped version that integrates Maxim's observability features including
 * trace logging, generation tracking, and attachment handling. If the model specification
 * is not supported, it logs an error and returns the original model.
 *
 * @template T - The type of the language model (must extend LanguageModelV1, LanguageModelV2, LanguageModelV3, or LanguageModelV4).
 * @param model - The Vercel AI SDK language model instance to wrap (supports v1, v2, v3, and v4 specifications).
 * @param logger - The MaximLogger instance to use for tracing and logging.
 * @returns The wrapped model with Maxim integration, or the original model if the specification version is unsupported.
 */
export function wrapMaximAISDKModel<T extends LanguageModelV1 | LanguageModelV2 | LanguageModelV3 | LanguageModelV4>(
	model: T,
	logger: MaximLogger,
): T {
	if (model?.specificationVersion === "v1") {
		return new MaximAISDKWrapper(model, logger) as unknown as T;
	}
	if (model?.specificationVersion === "v2") {
		return new MaximAISDKWrapperV2(model, logger) as unknown as T;
	}
	if (model?.specificationVersion === "v3") {
		return new MaximAISDKWrapperV3(model, logger) as unknown as T;
	}
	if (model?.specificationVersion === "v4") {
		return new MaximAISDKWrapperV4(model, logger) as unknown as T;
	}
	console.error("[MaximSDK] Unsupported model");
	return model;
}
