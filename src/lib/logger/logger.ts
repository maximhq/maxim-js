import { MaximCache } from "../cache/cache";
import { ErrorConfig, Error as MaximError } from "./components";
import {
	ChatCompletionResult,
	CompletionRequest,
	Generation,
	GenerationConfig,
	GenerationError,
	TextCompletionResult,
} from "./components/generation";
import { Retrieval, RetrievalConfig } from "./components/retrieval";
import { Session, SessionConfig } from "./components/session";
import { Span, SpanConfig } from "./components/span";
import { ToolCall, ToolCallConfig, ToolCallError } from "./components/toolCall";
import { Trace, TraceConfig } from "./components/trace";
import { Entity } from "./components/types";
import { uniqueId } from "./utils";
import { LogWriter } from "./writer";

export type LoggerConfig = {
	id: string;
	autoFlush?: boolean;
	flushIntervalSeconds?: number;
};

/**
 * This is the main logger class for the Maxim SDK.
 * It manages the entire lifecycle of capturing , storing and sending logs to the Maxim backend.
 * Users can use cache for distribute logging.
 */
export class MaximLogger {
	private _id: string;
	private readonly writer: LogWriter;
	private readonly isDebug: boolean;

	constructor(params: {
		config: LoggerConfig;
		apiKey: string;
		baseUrl: string;
		isDebug?: boolean;
		cache: MaximCache;
		raiseExceptions: boolean;
	}) {
		const { config, apiKey, baseUrl } = params;
		if (!config.id) {
			throw new Error("Logger must be initialized with id of the logger");
		}
		this._id = config.id;
		this.isDebug = params.isDebug || false;
		this.writer = new LogWriter({
			isDebug: this.isDebug,
			autoFlush: config.autoFlush || true,
			flushInterval: config.flushIntervalSeconds || 10,
			baseUrl: baseUrl,
			apiKey: apiKey,
			repositoryId: config.id,
			cache: params.cache,
			raiseExceptions: params.raiseExceptions,
		});
	}

	public session(config: SessionConfig): Session {
		return new Session(config, this.writer);
	}

	public trace(config: TraceConfig): Trace {
		return new Trace(config, this.writer);
	}

	public get id(): string {
		return this._id;
	}

	public async cleanup(): Promise<void> {
		await this.writer.cleanup();
	}

	// Session methods

	public sessionTag(sessionId: string, key: string, value: string) {
		Session.addTag_(this.writer, sessionId, key, value);
	}

	public sessionEnd(sessionId: string, data?: any) {
		Session.end_(this.writer, sessionId, data);
	}

	public sessionFeedback(sessionId: string, feedback: { score: number; comment?: string }) {
		Session.feedback_(this.writer, sessionId, feedback);
	}

	public sessionTrace(sessionId: string, config: TraceConfig) {
		return Session.trace_(this.writer, sessionId, config);
	}

	public sessionEvaluate(sessionId: string) {
		return Session.evaluate_(this.writer, Entity.SESSION, sessionId);
	}

	// Trace method

	public traceGeneration(traceId: string, config: GenerationConfig) {
		return Trace.generation_(this.writer, traceId, config);
	}

	public traceToolCall(traceId: string, config: ToolCallConfig) {
		return Trace.toolCall_(this.writer, traceId, config);
	}

	public traceRetrieval(traceId: string, config: RetrievalConfig) {
		return Trace.retrieval_(this.writer, traceId, config);
	}

	public traceOutput(traceId: string, output: string) {
		Trace.output_(this.writer, traceId, output);
	}

	public traceError(traceId: string, config: ErrorConfig): MaximError {
		return Trace.error_(this.writer, traceId, config);
	}

	public traceInput(traceId: string, input: string) {
		Trace.input_(this.writer, traceId, input);
	}

	public traceSpan(traceId: string, config: SpanConfig) {
		return Trace.span_(this.writer, traceId, config);
	}

	public traceAddToSession(traceId: string, sessionId: string) {
		Trace.addToSession_(this.writer, traceId, sessionId);
	}

	public traceTag(traceId: string, key: string, value: string) {
		Trace.addTag_(this.writer, traceId, key, value);
	}

	public traceEvent(
		traceId: string,
		eventId: string,
		eventName: string,
		tags?: Record<string, string>,
		metadata?: Record<string, unknown>,
	): void;
	/** @deprecated Use the method with explicit eventId and eventName instead */
	public traceEvent(traceId: string, eventName: string, tags?: Record<string, string>, metadata?: Record<string, unknown>): void;

	public traceEvent(...args: any[]) {
		try {
			if (args.length === 3) {
				const [traceId, eventName, tags] = args;
				Trace.event_(this.writer, Entity.TRACE, traceId, uniqueId(), eventName, tags);
				return;
			}
			const [traceId, eventId, eventName, tags, metadata] = args;
			Trace.event_(this.writer, Entity.TRACE, traceId, eventId, eventName, tags, metadata);
		} catch (error) {
			console.error(new Error(`Failed to log trace event. Please check the parameters you are passing to the traceEvent method.`));
		}
	}

	public traceFeedback(traceId: string, feedback: { score: number; comment?: string }) {
		Trace.feedback_(this.writer, traceId, feedback);
	}

	public traceMetadata(traceId: string, metadata: Record<string, unknown>) {
		Trace.addMetadata_(this.writer, Entity.TRACE, traceId, metadata);
	}

	public traceEvaluate(traceId: string) {
		return Trace.evaluate_(this.writer, Entity.TRACE, traceId);
	}

	public traceEnd(traceId: string, data?: any) {
		Trace.end_(this.writer, traceId, data);
	}

	// Generation methods

	public generationSetModel(generationId: string, model: string) {
		Generation.setModel_(this.writer, generationId, model);
	}

	public generationAddMessage(generationId: string, messages: CompletionRequest[]) {
		Generation.addMessages_(this.writer, generationId, messages);
	}

	public generationSetModelParameters(generationId: string, modelParameters: Record<string, any>) {
		Generation.setModelParameters_(this.writer, generationId, modelParameters);
	}

	public generationResult(generationId: string, result: TextCompletionResult | ChatCompletionResult) {
		Generation.result_(this.writer, generationId, result);
	}

	public generationError(generationId: string, error: GenerationError) {
		Generation.error_(this.writer, generationId, error);
	}

	public generationMetadata(generationId: string, metadata: Record<string, unknown>) {
		Generation.addMetadata_(this.writer, Entity.GENERATION, generationId, metadata);
	}

	public generationEvaluate(generationId: string) {
		return Generation.evaluate_(this.writer, Entity.GENERATION, generationId);
	}

	public generationEnd(generationId: string, data?: any) {
		Generation.end_(this.writer, generationId, data);
	}

	// Span methods

	public spanGeneration(spanId: string, config: GenerationConfig) {
		return Span.generation_(this.writer, spanId, config);
	}

	public spanRetrieval(spanId: string, config: RetrievalConfig) {
		return Span.retrieval_(this.writer, spanId, config);
	}

	public spanToolCall(spanId: string, config: ToolCallConfig) {
		return Span.toolCall_(this.writer, spanId, config);
	}

	public spanSpan(spanId: string, config: SpanConfig) {
		return Span.span_(this.writer, spanId, config);
	}

	public spanTag(spanId: string, key: string, value: string) {
		return Span.addTag_(this.writer, spanId, key, value);
	}

	public spanError(spanId: string, config: ErrorConfig): MaximError {
		return Span.error_(this.writer, spanId, config);
	}

	public spanEvent(
		spanId: string,
		eventId: string,
		eventName: string,
		tags?: Record<string, string>,
		metadata?: Record<string, unknown>,
	): void;
	/** @deprecated Use the method with explicit eventId and eventName instead */
	public spanEvent(spanId: string, eventName: string, tags?: Record<string, string>, metadata?: Record<string, unknown>): void;
	public spanEvent(...args: any[]) {
		try {
			if (args.length === 3) {
				const [spanId, eventName, tags] = args;
				return Span.event_(this.writer, Entity.SPAN, spanId, uniqueId(), eventName, tags);
			}
			const [spanId, eventId, eventName, tags, metadata] = args;
			return Span.event_(this.writer, Entity.SPAN, spanId, eventId, eventName, tags, metadata);
		} catch (error) {
			console.error(new Error(`Failed to log span event. Please check the parameters you are passing to the spanEvent method.`));
		}
	}

	public spanMetadata(spanId: string, metadata: Record<string, unknown>) {
		return Span.addMetadata_(this.writer, Entity.SPAN, spanId, metadata);
	}

	public spanEvaluate(spanId: string) {
		return Span.evaluate_(this.writer, Entity.SPAN, spanId);
	}

	public spanEnd(spanId: string, data?: any) {
		return Span.end_(this.writer, spanId, data);
	}

	// Retrieval methods

	public retrievalEnd(retrievalId: string) {
		Retrieval.end_(this.writer, retrievalId);
	}

	public retrievalAddTag(retrievalId: string, key: string, value: string) {
		Retrieval.addTag_(this.writer, retrievalId, key, value);
	}

	public retrievalInput(retrievalId: string, input: string) {
		Retrieval.input_(this.writer, retrievalId, input);
	}

	public retrievalOutput(retrievalId: string, output: string) {
		Retrieval.output_(this.writer, retrievalId, output);
	}

	public retrievalMetadata(retrievalId: string, metadata: Record<string, unknown>) {
		return Retrieval.addMetadata_(this.writer, Entity.RETRIEVAL, retrievalId, metadata);
	}

	public retrievalEvaluate(retrievalId: string) {
		return Retrieval.evaluate_(this.writer, Entity.RETRIEVAL, retrievalId);
	}

	// Tool call methods

	public toolCallResult(toolCallId: string, result: string) {
		return ToolCall.result_(this.writer, toolCallId, result);
	}

	public toolCallError(toolCallId: string, error: ToolCallError) {
		return ToolCall.error_(this.writer, toolCallId, error);
	}

	public toolCallMetadata(toolCallId: string, metadata: Record<string, unknown>) {
		return ToolCall.addMetadata_(this.writer, Entity.TOOL_CALL, toolCallId, metadata);
	}

	public flush() {
		this.writer.flush();
	}
}
