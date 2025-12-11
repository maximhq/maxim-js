import { MaximLogsAPI } from "../apis/logs";
import { ChatCompletionMessage, CompletionRequest } from "../models/prompt";
import type { Attachment } from "../types";
import { CaptureWriter } from "./captureWriter";
import { Error as MaximError, type ErrorConfig } from "./components/error";
import { ChatCompletionResult, Generation, GenerationConfig, GenerationError, TextCompletionResult } from "./components/generation";
import { Retrieval, RetrievalConfig } from "./components/retrieval";
import { Session, SessionConfig } from "./components/session";
import { Span, SpanConfig } from "./components/span";
import { ToolCall, ToolCallConfig, ToolCallError } from "./components/toolCall";
import { Trace, TraceConfig } from "./components/trace";
import { CommitLog, Entity } from "./components/types";
import type { MaximLogger } from "./logger";
import { uniqueId } from "./utils";

export type LogLinePushConfig = {
	apiKey: string;
	baseUrl?: string;
	repositoryId: string;
	logs: CommitLog[];
	debug?: boolean;
};

// Extract only public method signatures from MaximLogger.
type IMaximLogger = {
	[K in keyof MaximLogger]: MaximLogger[K];
};

/**
 * A logger class for creating log lines without initializing a Maxim instance.
 *
 * This class implements MaximLogger but captures logs internally instead of sending them.
 * Use `drain()` to get captured logs and `LogLine.push()` to send them.
 *
 * @example
 * const logLine = new LogLine();
 *
 * // add logs
 * logLine.trace({ id: 'trace-1', name: 'My trace' });
 * logLine.traceInput('trace-1', 'user input');
 * logLine.traceEnd('trace-1');
 *
 * // fetch all the commit logs
 * const logs = logLine.drain();
 *
 * // send the logs to server
 * await LogLine.push({
 *   apiKey: process.env.MAXIM_API_KEY,
 *   repositoryId: 'my-repo-id',
 *   logs,
 * });
 */
export class LogLine implements IMaximLogger {
	private _captureWriter: CaptureWriter = new CaptureWriter();

	/**
	 * Drains all captured logs and returns them. Clears the internal buffer.
	 */
	public drain(): CommitLog[] {
		return this._captureWriter.drain();
	}

	/**
	 * Returns all captured logs without clearing the buffer.
	 */
	public get logs(): CommitLog[] {
		return [...this._captureWriter.logs];
	}

	public static async push(config: LogLinePushConfig): Promise<void> {
		const { apiKey, repositoryId, logs, debug } = config;
		const baseUrl = config.baseUrl || "https://app.getmaxim.ai";

		if (logs.length === 0) {
			return;
		}

		const serializedLogs = logs.map((log) => log.serialize()).join("\n");
		const api = new MaximLogsAPI(baseUrl, apiKey, debug);

		try {
			await api.pushLogs(repositoryId, serializedLogs);
		} finally {
			api.destroyAgents();
		}
	}

	// ============================================
	// Session methods
	// ============================================

	public session(config: SessionConfig): Session {
		return new Session(config, this._captureWriter);
	}

	public sessionTag(sessionId: string, key: string, value: string): void {
		Session.addTag_(this._captureWriter, Entity.SESSION, sessionId, key, value);
	}

	public sessionEnd(sessionId: string, data?: any): void {
		Session.end_(this._captureWriter, Entity.SESSION, sessionId, data);
	}

	public sessionFeedback(sessionId: string, feedback: { score: number; comment?: string }): void {
		Session.feedback_(this._captureWriter, sessionId, feedback);
	}

	public sessionAddMetric(sessionId: string, name: string, value: number): void {
		Session.addMetric_(this._captureWriter, sessionId, name, value);
	}

	public sessionTrace(sessionId: string, config: TraceConfig): Trace {
		return Session.trace_(this._captureWriter, sessionId, config);
	}

	public sessionEvaluate(sessionId: string) {
		return Session.evaluate_(this._captureWriter, Entity.SESSION, sessionId);
	}

	// ============================================
	// Trace methods
	// ============================================

	public trace(config: TraceConfig): Trace {
		return new Trace(config, this._captureWriter);
	}

	public traceGeneration(traceId: string, config: GenerationConfig): Generation {
		return Trace.generation_(this._captureWriter, traceId, config);
	}

	public traceToolCall(traceId: string, config: ToolCallConfig): ToolCall {
		return Trace.toolCall_(this._captureWriter, traceId, config);
	}

	public traceRetrieval(traceId: string, config: RetrievalConfig): Retrieval {
		return Trace.retrieval_(this._captureWriter, traceId, config);
	}

	public traceOutput(traceId: string, output: string): void {
		Trace.output_(this._captureWriter, traceId, output);
	}

	public traceError(traceId: string, config: ErrorConfig): MaximError {
		return Trace.error_(this._captureWriter, traceId, config);
	}

	public traceInput(traceId: string, input: string): void {
		Trace.input_(this._captureWriter, traceId, input);
	}

	public traceSpan(traceId: string, config: SpanConfig): Span {
		return Trace.span_(this._captureWriter, traceId, config);
	}

	public traceAddToSession(traceId: string, sessionId: string): void {
		Trace.addToSession_(this._captureWriter, traceId, sessionId);
	}

	public traceAddMetric(traceId: string, name: string, value: number): void {
		Trace.addMetric_(this._captureWriter, traceId, name, value);
	}

	public traceAddAttachment(traceId: string, attachment: Attachment): void {
		Trace.addAttachment_(this._captureWriter, traceId, attachment);
	}

	public traceTag(traceId: string, key: string, value: string): void {
		Trace.addTag_(this._captureWriter, Entity.TRACE, traceId, key, value);
	}

	public traceEvent(
		traceId: string,
		eventIdOrName: string,
		eventNameOrTags?: string | Record<string, string>,
		tagsOrMetadata?: Record<string, string> | Record<string, unknown>,
		metadata?: Record<string, unknown>,
	): void {
		if (typeof eventNameOrTags === "string") {
			Trace.event_(
				this._captureWriter,
				Entity.TRACE,
				traceId,
				eventIdOrName,
				eventNameOrTags,
				tagsOrMetadata as Record<string, string>,
				metadata,
			);
		} else {
			Trace.event_(
				this._captureWriter,
				Entity.TRACE,
				traceId,
				uniqueId(),
				eventIdOrName,
				eventNameOrTags as Record<string, string>,
				tagsOrMetadata as Record<string, unknown>,
			);
		}
	}

	public traceFeedback(traceId: string, feedback: { score: number; comment?: string }): void {
		Trace.feedback_(this._captureWriter, traceId, feedback);
	}

	public traceMetadata(traceId: string, metadata: Record<string, unknown>): void {
		Trace.addMetadata_(this._captureWriter, Entity.TRACE, traceId, metadata);
	}

	public traceEvaluate(traceId: string) {
		return Trace.evaluate_(this._captureWriter, Entity.TRACE, traceId);
	}

	public traceEnd(traceId: string, data?: any): void {
		Trace.end_(this._captureWriter, Entity.TRACE, traceId, data);
	}

	// ============================================
	// Generation methods
	// ============================================

	public generationSetModel(generationId: string, model: string): void {
		Generation.setModel_(this._captureWriter, generationId, model);
	}

	public generationAddTag(generationId: string, key: string, value: string): void {
		Generation.addTag_(this._captureWriter, Entity.GENERATION, generationId, key, value);
	}

	public generationAddMessage(generationId: string, messages: (CompletionRequest | ChatCompletionMessage)[]): void {
		Generation.addMessages_(this._captureWriter, generationId, messages);
	}

	public generationSetModelParameters(generationId: string, modelParameters: Record<string, any>): void {
		Generation.setModelParameters_(this._captureWriter, generationId, modelParameters);
	}

	public generationAddMetric(generationId: string, name: string, value: number): void {
		Generation.addMetric_(this._captureWriter, generationId, name, value);
	}

	public generationResult(generationId: string, result: TextCompletionResult | ChatCompletionResult): void {
		Generation.result_(this._captureWriter, generationId, result);
	}

	public generationError(generationId: string, error: GenerationError): void {
		Generation.error_(this._captureWriter, generationId, error);
	}

	public generationMetadata(generationId: string, metadata: Record<string, unknown>): void {
		Generation.addMetadata_(this._captureWriter, Entity.GENERATION, generationId, metadata);
	}

	public generationEvaluate(generationId: string) {
		return Generation.evaluate_(this._captureWriter, Entity.GENERATION, generationId);
	}

	public generationEnd(generationId: string, data?: any): void {
		Generation.end_(this._captureWriter, Entity.GENERATION, generationId, data);
	}

	public generationAddAttachment(generationId: string, attachment: Attachment): void {
		Generation.addAttachment_(this._captureWriter, generationId, attachment);
	}

	// ============================================
	// Span methods
	// ============================================

	public spanGeneration(spanId: string, config: GenerationConfig): Generation {
		return Span.generation_(this._captureWriter, spanId, config);
	}

	public spanRetrieval(spanId: string, config: RetrievalConfig): Retrieval {
		return Span.retrieval_(this._captureWriter, spanId, config);
	}

	public spanToolCall(spanId: string, config: ToolCallConfig): ToolCall {
		return Span.toolCall_(this._captureWriter, spanId, config);
	}

	public spanSpan(spanId: string, config: SpanConfig): Span {
		return Span.span_(this._captureWriter, spanId, config);
	}

	public spanTag(spanId: string, key: string, value: string): void {
		Span.addTag_(this._captureWriter, Entity.SPAN, spanId, key, value);
	}

	public spanError(spanId: string, config: ErrorConfig): MaximError {
		return Span.error_(this._captureWriter, spanId, config);
	}

	public spanEvent(
		spanId: string,
		eventIdOrName: string,
		eventNameOrTags?: string | Record<string, string>,
		tagsOrMetadata?: Record<string, string> | Record<string, unknown>,
		metadata?: Record<string, unknown>,
	): void {
		if (typeof eventNameOrTags === "string") {
			Span.event_(
				this._captureWriter,
				Entity.SPAN,
				spanId,
				eventIdOrName,
				eventNameOrTags,
				tagsOrMetadata as Record<string, string>,
				metadata,
			);
		} else {
			Span.event_(
				this._captureWriter,
				Entity.SPAN,
				spanId,
				uniqueId(),
				eventIdOrName,
				eventNameOrTags as Record<string, string>,
				tagsOrMetadata as Record<string, unknown>,
			);
		}
	}

	public spanMetadata(spanId: string, metadata: Record<string, unknown>): void {
		Span.addMetadata_(this._captureWriter, Entity.SPAN, spanId, metadata);
	}

	public spanEvaluate(spanId: string) {
		return Span.evaluate_(this._captureWriter, Entity.SPAN, spanId);
	}

	public spanEnd(spanId: string, data?: any): void {
		Span.end_(this._captureWriter, Entity.SPAN, spanId, data);
	}

	public spanAddAttachment(spanId: string, attachment: Attachment): void {
		Span.addAttachment_(this._captureWriter, spanId, attachment);
	}

	// ============================================
	// Retrieval methods
	// ============================================

	public retrievalEnd(retrievalId: string): void {
		Retrieval.end_(this._captureWriter, Entity.RETRIEVAL, retrievalId);
	}

	public retrievalAddTag(retrievalId: string, key: string, value: string): void {
		Retrieval.addTag_(this._captureWriter, Entity.RETRIEVAL, retrievalId, key, value);
	}

	public retrievalInput(retrievalId: string, input: string): void {
		Retrieval.input_(this._captureWriter, retrievalId, input);
	}

	public retrievalAddMetric(retrievalId: string, name: string, value: number): void {
		Retrieval.addMetric_(this._captureWriter, retrievalId, name, value);
	}

	public retrievalOutput(retrievalId: string, output: string | string[]): void {
		Retrieval.output_(this._captureWriter, retrievalId, output);
	}

	public retrievalMetadata(retrievalId: string, metadata: Record<string, unknown>): void {
		Retrieval.addMetadata_(this._captureWriter, Entity.RETRIEVAL, retrievalId, metadata);
	}

	public retrievalEvaluate(retrievalId: string) {
		return Retrieval.evaluate_(this._captureWriter, Entity.RETRIEVAL, retrievalId);
	}

	// ============================================
	// Tool call methods
	// ============================================

	public toolCallResult(toolCallId: string, result: string): void {
		ToolCall.result_(this._captureWriter, toolCallId, result);
	}

	public toolCallError(toolCallId: string, error: ToolCallError): void {
		ToolCall.error_(this._captureWriter, toolCallId, error);
	}

	public toolCallAddTag(toolCallId: string, key: string, value: string): void {
		ToolCall.addTag_(this._captureWriter, Entity.TOOL_CALL, toolCallId, key, value);
	}

	public toolCallMetadata(toolCallId: string, metadata: Record<string, unknown>): void {
		ToolCall.addMetadata_(this._captureWriter, Entity.TOOL_CALL, toolCallId, metadata);
	}

	/**
	 * @deprecated **DO NOT USE.**
	 */
	public get id(): string {
		return "log-line";
	}

	/**
	 * @deprecated **DO NOT USE.** Use `LogLine.push()` instead.
	 */
	public async cleanup(): Promise<void> {
		throw new Error("LogLine.cleanup() is not supported. Use LogLine.push() to send logs.");
	}

	/**
	 * @deprecated **DO NOT USE.** Use `LogLine.push()` instead.
	 */
	public async flush(): Promise<void> {
		throw new Error("LogLine.flush() is not supported. Use LogLine.push() to send logs.");
	}
}
