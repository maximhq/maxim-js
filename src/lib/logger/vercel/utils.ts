import { LanguageModelV1CallOptions, LanguageModelV1ProviderMetadata } from "ai-sdk-provider-v1";
import { LanguageModelV2CallOptions, LanguageModelV2ToolResultOutput, SharedV2ProviderOptions } from "ai-sdk-provider-v2";
import { LanguageModelV3CallOptions, LanguageModelV3ToolResultOutput, SharedV3ProviderOptions } from "ai-sdk-provider-v3";
import { LanguageModelV4CallOptions, LanguageModelV4ToolResultOutput, SharedV4ProviderOptions } from "ai-sdk-provider-v4";
import { v4 as uuid } from "uuid";
import { getMaximFlushStore } from "./lambda";
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
export function extractModelParameters(
	options: LanguageModelV1CallOptions | LanguageModelV2CallOptions | LanguageModelV3CallOptions | LanguageModelV4CallOptions,
) {
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
	metadata: LanguageModelV1ProviderMetadata | SharedV2ProviderOptions | SharedV3ProviderOptions | SharedV4ProviderOptions | undefined,
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

export function parseToolResultOutput(
	content: LanguageModelV2ToolResultOutput | LanguageModelV3ToolResultOutput | LanguageModelV4ToolResultOutput,
): string {
	switch (content.type) {
		case "text":
		case "error-text":
			return content.value;
		case "json":
		case "error-json":
		case "content":
			return JSON.stringify(content.value);
		// v4 introduces `execution-denied` for tool calls the user declined to run
		case "execution-denied":
			return content.reason ?? "Tool execution denied";
		default:
			throw new Error(`Unknown tool result type: ${JSON.stringify(content)}`);
	}
}

type WaitUntil = (promise: Promise<unknown>) => void;

/**
 * Minimal interface of MaximLogger needed by the flush strategy helpers.
 * Kept structural to avoid an import cycle with `../logger`.
 */
interface FlushableLogger {
	flush(): Promise<void>;
}

/**
 * Returns Vercel's `waitUntil` if running inside a Vercel Function request context.
 *
 * Vercel exposes the request context on a well-known global symbol; `waitUntil`
 * keeps the function alive after the response completes, which is exactly the
 * window needed to upload telemetry without blocking the response stream.
 */
function getVercelWaitUntil(): WaitUntil | undefined {
	try {
		const ctx = (globalThis as Record<PropertyKey, unknown>)[Symbol.for("@vercel/request-context") as unknown as string] as
			| { get?: () => { waitUntil?: WaitUntil } | undefined }
			| undefined;
		const waitUntil = ctx?.get?.()?.waitUntil;
		return typeof waitUntil === "function" ? waitUntil : undefined;
	} catch {
		return undefined;
	}
}

type DeferTask = (fn: () => void | Promise<unknown>) => void;

// `undefined` = not yet resolved, `null` = unavailable on this runtime.
let expoDeferTask: DeferTask | null | undefined;

/**
 * Returns Expo server's `deferTask` if the `expo/server` runtime is available.
 *
 * `deferTask` runs its callback after the response has been sent and keeps the
 * request handler alive until it settles — the same post-response window as
 * Vercel's `waitUntil`, so telemetry uploads without adding response latency.
 * `expo/server` is an optional peer, loaded defensively (and memoized) so
 * non-Expo runtimes (where the module is absent) degrade to the next flush
 * strategy instead of throwing at flush time.
 */
function getExpoDeferTask(): DeferTask | undefined {
	if (expoDeferTask !== undefined) {
		return expoDeferTask ?? undefined;
	}
	try {
		const expoServer = require("expo/server") as { deferTask?: DeferTask };
		expoDeferTask = typeof expoServer.deferTask === "function" ? expoServer.deferTask : null;
	} catch {
		expoDeferTask = null;
	}
	return expoDeferTask ?? undefined;
}

function isOnAWSLambda(): boolean {
	return process.env["AWS_LAMBDA_FUNCTION_NAME"] !== undefined;
}

function safeFlush(logger: FlushableLogger): Promise<void> {
	return logger.flush().catch((err) => {
		console.error(`[MaximSDK] Background log flush failed: ${err instanceof Error ? err.message : err}`);
	});
}

/**
 * Flushes logs using an environment-appropriate strategy, never blocking the
 * caller unless the environment gives no alternative:
 *
 * - `withMaximLambdaHandler` active: register the flush on the invocation's
 *   flush store — the handler wrapper awaits it (capped) in the window after
 *   the response closes, so nothing blocks here.
 * - Vercel Functions: hand the flush to `waitUntil` — the runtime keeps the
 *   function alive after the response finishes, guaranteeing delivery with no
 *   added response latency.
 * - Expo server (`expo/server`): hand the flush to `deferTask` — it runs after
 *   the response is sent and keeps the request handler alive until it settles,
 *   the same post-response window as Vercel's `waitUntil`.
 * - AWS Lambda (no `waitUntil` available): await the flush — the sandbox may
 *   freeze as soon as the response completes, so blocking is the only way to
 *   guarantee delivery.
 * - Long-running servers: fire-and-forget — delivery is covered by the
 *   background flush plus the writer's auto-flush interval and `cleanup()`.
 */
export function scheduleLoggerFlush(logger: FlushableLogger): Promise<void> {
	const flushStore = getMaximFlushStore();
	if (flushStore) {
		flushStore.pending.push(safeFlush(logger));
		return Promise.resolve();
	}
	const waitUntil = getVercelWaitUntil();
	if (waitUntil) {
		waitUntil(safeFlush(logger));
		return Promise.resolve();
	}
	const deferTask = getExpoDeferTask();
	if (deferTask) {
		try {
			deferTask(() => safeFlush(logger));
		} catch {
			// `deferTask` was called outside an Expo request context — fall back to
			// a background flush so a log is never dropped on the floor.
			void safeFlush(logger);
		}
		return Promise.resolve();
	}
	if (isOnAWSLambda()) {
		return safeFlush(logger);
	}
	void safeFlush(logger);
	return Promise.resolve();
}

/**
 * Orders a stream close against the log flush per environment:
 *
 * - `withMaximLambdaHandler` active: close first, then register the flush on
 *   the invocation's flush store — the handler wrapper awaits it (capped) after
 *   the response closes, so the consumer unblocks immediately and logs are
 *   still delivered before the sandbox freezes.
 * - Vercel Functions: close first (consumer unblocks immediately), then flush
 *   inside `waitUntil`.
 * - Expo server (`expo/server`): close first, then flush inside `deferTask` —
 *   it runs after the response is sent and holds the request open until the
 *   upload settles, so the consumer unblocks immediately and logs still deliver.
 * - AWS Lambda: flush first, then close — closing ends the response, after
 *   which the sandbox may freeze before the upload completes.
 * - Long-running servers: close first, flush in the background.
 *
 * `streamText` only emits finish / ends the UI message stream once the model
 * stream closes, so anything awaited before `close()` directly delays the
 * consumer.
 */
export async function flushAndCloseStream(logger: FlushableLogger, close: () => void): Promise<void> {
	const flushStore = getMaximFlushStore();
	if (flushStore) {
		close();
		flushStore.pending.push(safeFlush(logger));
		return;
	}
	const waitUntil = getVercelWaitUntil();
	if (waitUntil) {
		close();
		waitUntil(safeFlush(logger));
		return;
	}
	const deferTask = getExpoDeferTask();
	if (deferTask) {
		close();
		try {
			deferTask(() => safeFlush(logger));
		} catch {
			// `deferTask` was called outside an Expo request context — fall back to
			// a background flush so a log is never dropped on the floor.
			void safeFlush(logger);
		}
		return;
	}
	if (isOnAWSLambda()) {
		await safeFlush(logger);
		close();
		return;
	}
	close();
	void safeFlush(logger);
}
