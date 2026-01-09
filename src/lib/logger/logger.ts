import { MaximCache } from "../cache/cache";
import { ChatCompletionMessage, CompletionRequest } from "../models/prompt";
import { ErrorConfig, Error as MaximError } from "./components";
import { ChatCompletionResult, Generation, GenerationConfig, GenerationError, TextCompletionResult } from "./components/generation";
import { Retrieval, RetrievalConfig } from "./components/retrieval";
import { Session, SessionConfig } from "./components/session";
import { Span, SpanConfig } from "./components/span";
import { ToolCall, ToolCallConfig, ToolCallError } from "./components/toolCall";
import { Trace, TraceConfig } from "./components/trace";
import { Entity } from "./components/types";
import { uniqueId } from "./utils";
import { LogWriter } from "./writer";
import { Attachment } from "../types";

/**
 * Configuration object for initializing a MaximLogger instance.
 */
export type LoggerConfig = {
	id: string;
	autoFlush?: boolean;
	flushIntervalSeconds?: number;
};

/**
 * Main logger class for the Maxim SDK providing comprehensive observability capabilities.
 *
 * Manages the entire lifecycle of capturing, storing, and sending logs to the Maxim
 * backend. Supports distributed logging and provides methods for logging sessions,
 * traces, generations, tool calls, retrievals, and other observability events.
 * Essential for monitoring AI applications and understanding system behavior.
 *
 * @class MaximLogger
 * @example
 * import { Maxim } from '@maximai/maxim-js';
 *
 * // Create logger through Maxim instance
 * const maxim = new Maxim({ apiKey: 'your-api-key' });
 * const logger = await maxim.logger({ id: 'my-app' });
 */
export class MaximLogger {
	private _id: string;
	private readonly writer: LogWriter;
	private readonly isDebug: boolean;

	/**
	 * Creates a new MaximLogger instance.
	 *
	 * @param params - Configuration parameters for the logger
	 * @param params.config - Logger configuration including ID and flush settings
	 * @param params.apiKey - API key for authenticating with Maxim backend
	 * @param params.baseUrl - Base URL for the Maxim API
	 * @param params.isDebug - Enable debug mode for additional logging
	 * @param params.cache - Cache implementation for distributed logging
	 * @param params.raiseExceptions - Whether to raise exceptions or log them
	 * @throws {Error} When logger ID is not provided in the configuration
	 * @example
	 * // Usually created through Maxim.logger() method
	 * const logger = new MaximLogger({
	 *   config: { id: 'my-app', autoFlush: true },
	 *   apiKey: 'your-api-key',
	 *   baseUrl: 'https://app.getmaxim.ai',
	 *   cache: new MaximInMemoryCache(),
	 *   raiseExceptions: false
	 * });
	 */
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

	/**
	 * Creates a new session.
	 *
	 * Sessions represent high-level mutli-turn user interactions,
	 * containing multiple traces that represent individual turn interaction within
	 * that session. Useful for tracking user journeys.
	 *
	 * @param config - Configuration for the session
	 * @returns A new session instance for logging activities
	 * @example
	 * const session = logger.session({
	 *   id: 'user-session-123',
	 *   name: 'Customer Support Chat',
	 * });
	 *
	 * // Add feedback to the session
	 * session.feedback({ score: 5, comment: 'Very helpful!' });
	 * session.end();
	 */
	public session(config: SessionConfig): Session {
		return new Session(config, this.writer);
	}

	/**
	 * Creates a new trace.
	 *
	 * Traces represent individual workflows or processes, containing
	 * generations, tool calls, retrievals, and other components. They
	 * provide detailed information about operations in a single conversation turn
	 * with the user.
	 *
	 * @param config - Configuration for the trace
	 * @returns A new trace instance for logging operations
	 * @example
	 * const trace = logger.trace({
	 *   id: 'query-trace-456',
	 *   name: 'Document Analysis',
	 * });
	 *
	 * // Add input and output to the trace
	 * trace.input('Analyze this contract document');
	 * // ...Log other operations
	 * trace.output('Contract analysis complete: 3 issues found');
	 * trace.end();
	 */
	public trace(config: TraceConfig): Trace {
		return new Trace(config, this.writer);
	}

	/**
	 * Gets the unique identifier for this logger instance.
	 *
	 * @returns The logger's unique ID
	 */
	public get id(): string {
		return this._id;
	}

	/**
	 * Cleans up resources and ensures all pending logs are flushed.
	 *
	 * Should be called before application shutdown to ensure no logs are lost.
	 * Waits for all pending write operations to complete.
	 *
	 * @async
	 * @returns Promise that resolves when cleanup is complete
	 * @example
	 * // Cleanup before app shutdown
	 * process.on('SIGTERM', async () => {
	 *   await logger.cleanup();
	 *   process.exit(0);
	 * });
	 */
	public async cleanup(): Promise<void> {
		await this.writer.cleanup();
	}

	// Session methods

	/**
	 * Adds a tag to a session for categorization and filtering.
	 *
	 * @param sessionId - The unique identifier of the session
	 * @param key - The tag key
	 * @param value - The tag value
	 * @returns void
	 * @example
	 * logger.sessionTag('session-123', 'environment', 'production');
	 * logger.sessionTag('session-123', 'user_type', 'premium');
	 */
	public sessionTag(sessionId: string, key: string, value: string) {
		Session.addTag_(this.writer, Entity.SESSION, sessionId, key, value);
	}

	/**
	 * Ends a session and records the end timestamp.
	 *
	 * @param sessionId - The unique identifier of the session
	 * @returns void
	 * @example
	 * logger.sessionEnd('session-123');
	 */
	public sessionEnd(sessionId: string, data?: any) {
		Session.end_(this.writer, Entity.SESSION, sessionId, data);
	}

	/**
	 * Adds feedback to a session from users.
	 *
	 * @param sessionId - The unique identifier of the session
	 * @param feedback - Feedback object containing score and optional comment
	 * @param feedback.score - Numerical score for the session
	 * @param feedback.comment - Optional textual feedback
	 * @returns void
	 * @example
	 * logger.sessionFeedback('session-123', {
	 *   score: 5,
	 *   comment: 'Excellent customer service!'
	 * });
	 */
	public sessionFeedback(sessionId: string, feedback: { score: number; comment?: string }) {
		Session.feedback_(this.writer, sessionId, feedback);
	}

	/**
	 * Adds a numeric metric to a session.
	 *
	 * Records quantitative values such as counts and aggregates across all traces in the
	 * session under a named metric.
	 *
	 * Common examples include: `tool_calls_count`, `traces_count`, `user_messages_count`, `assistant_messages_count`.
	 *
	 * @param sessionId - The unique identifier of the session
	 * @param name - Name of the metric
	 * @param value - Numeric value of the metric (numeric)
	 * @returns void
	 * @example
	 * logger.sessionAddMetric('session-123', 'traces_count', 4);
	 */
	public sessionAddMetric(sessionId: string, name: string, value: number) {
		Session.addMetric_(this.writer, sessionId, name, value);
	}

	/**
	 * Creates a new trace associated with a session.
	 *
	 * @param sessionId - The unique identifier of the session
	 * @param config - Configuration for the new trace
	 * @returns A new trace instance associated with the session
	 * @example
	 * const trace = logger.sessionTrace('session-123', {
	 *   id: 'query-trace-001',
	 *   name: 'User Query Processing'
	 * });
	 */
	public sessionTrace(sessionId: string, config: TraceConfig) {
		return Session.trace_(this.writer, sessionId, config);
	}

	/**
	 * Gets the evaluation methods for a session.
	 *
	 * @param sessionId - The unique identifier of the session
	 * @returns Evaluation methods for configuring and triggering evaluations on the session
	 * @example
	 * logger.sessionEvaluate('session-123')
	 *   .withEvaluators('bias', 'toxicity')
	 *   .withVariables({ context: 'session_context' });
	 */
	public sessionEvaluate(sessionId: string) {
		return Session.evaluate_(this.writer, Entity.SESSION, sessionId);
	}

	// Trace method

	/**
	 * Creates a new generation (LLM call) associated with a trace.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param config - Configuration for the generation
	 * @returns A new generation instance associated with the trace
	 * @example
	 * const generation = logger.traceGeneration('trace-123', {
	 *   id: 'gen-001',
	 *   provider: 'openai',
	 *   model: 'gpt-4',
	 *   messages: [{ role: 'user', content: 'Hello!' }],
	 *   modelParameters: { temperature: 0.7 }
	 * });
	 */
	public traceGeneration(traceId: string, config: GenerationConfig) {
		return Trace.generation_(this.writer, traceId, config);
	}

	/**
	 * Creates a new tool call associated with a trace.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param config - Configuration for the tool call
	 * @returns A new tool call instance associated with the trace
	 * @example
	 * const toolCall = logger.traceToolCall('trace-123', {
	 *   id: 'tool-001',
	 *   name: 'search_database',
	 *   description: 'Search the product database',
	 *   args: JSON.stringify({ query: 'laptop' })
	 * });
	 */
	public traceToolCall(traceId: string, config: ToolCallConfig) {
		return Trace.toolCall_(this.writer, traceId, config);
	}

	/**
	 * Creates a new retrieval associated with a trace.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param config - Configuration for the retrieval
	 * @returns A new retrieval instance associated with the trace
	 * @example
	 * const retrieval = logger.traceRetrieval('trace-123', {
	 *   id: 'retrieval-001',
	 *   name: 'Knowledge Base Search'
	 * });
	 */
	public traceRetrieval(traceId: string, config: RetrievalConfig) {
		return Trace.retrieval_(this.writer, traceId, config);
	}

	/**
	 * Sets the output for a trace.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param output - The final output or result of the trace execution
	 * @returns void
	 * @example
	 * logger.traceOutput('trace-123', 'The analysis is complete: 95% confidence');
	 */
	public traceOutput(traceId: string, output: string) {
		Trace.output_(this.writer, traceId, output);
	}

	/**
	 * Creates an error associated with a trace.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param config - Configuration for the error
	 * @returns A new error instance associated with the trace
	 * @example
	 * const error = logger.traceError('trace-123', {
	 *   id: 'error-001',
	 *   message: 'Failed to process request',
	 *   code: 'PROCESSING_ERROR',
	 *   type: 'ProcessingError'
	 * });
	 */
	public traceError(traceId: string, config: ErrorConfig): MaximError {
		return Trace.error_(this.writer, traceId, config);
	}

	/**
	 * Sets the input for a trace.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param input - The input that triggered this trace
	 * @returns void
	 * @example
	 * logger.traceInput('trace-123', 'Analyze customer sentiment from reviews');
	 */
	public traceInput(traceId: string, input: string) {
		Trace.input_(this.writer, traceId, input);
	}

	/**
	 * Creates a new span associated with a trace.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param config - Configuration for the span
	 * @returns A new span instance associated with the trace
	 * @example
	 * const span = logger.traceSpan('trace-123', {
	 *   id: 'span-001',
	 *   name: 'Data Processing Phase'
	 * });
	 */
	public traceSpan(traceId: string, config: SpanConfig) {
		return Trace.span_(this.writer, traceId, config);
	}

	/**
	 * Associates a trace with a session.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param sessionId - The unique identifier of the session
	 * @returns void
	 * @example
	 * logger.traceAddToSession('trace-123', 'session-456');
	 */
	public traceAddToSession(traceId: string, sessionId: string) {
		Trace.addToSession_(this.writer, traceId, sessionId);
	}

	/**
	 * Adds a numeric metric to a trace.
	 *
	 * Records quantitative values such as tool call counts, retry attempts, total tokens,
	 * overall cost, or aggregated evaluation scores under a named metric.
	 *
	 * Common examples include: `tool_calls_count`, `retries_count`, `cost_usd`, `tokens_total`,
	 * `eval_overall_score`, `user_feedback_score`.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param name - Name of the metric
	 * @param value - Numeric value of the metric (numeric)
	 * @returns void
	 * @example
	 * logger.traceAddMetric('trace-123', 'tool_calls_count', 5);
	 * logger.traceAddMetric('trace-123', 'tokens_total', 1500);
	 */
	public traceAddMetric(traceId: string, name: string, value: number) {
		Trace.addMetric_(this.writer, traceId, name, value);
	}

	/**
	 * Adds an attachment to this trace.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param attachment - The attachment to add (can be of type file, data, or URL)
	 * @returns void
	 * @example
	 * logger.traceAddAttachment('trace-123',{
	 *   id: 'input-document',
	 *   type: 'file',
	 *   path: './uploads/document.pdf',
	 *   tags: { category: 'input' }
	 * });
	 */
	public traceAddAttachment(traceId: string, attachment: Attachment) {
		Trace.addAttachment_(this.writer, traceId, attachment);
	}

	/**
	 * Adds a tag to a trace for categorization and filtering.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param key - The tag key
	 * @param value - The tag value
	 * @returns void
	 * @example
	 * logger.traceTag('trace-123', 'operation', 'analysis');
	 * logger.traceTag('trace-123', 'priority', 'high');
	 */
	public traceTag(traceId: string, key: string, value: string) {
		Trace.addTag_(this.writer, Entity.TRACE, traceId, key, value);
	}

	/**
	 * Emits a custom event within a trace.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param eventId - Unique identifier for the event
	 * @param eventName - Human-readable name for the event
	 * @param tags - Optional tags for categorizing the event
	 * @param metadata - Optional metadata for additional context
	 * @returns void
	 * @example
	 * logger.traceEvent(
	 *   'trace-123',
	 *   'checkpoint-1',
	 *   'Processing Milestone',
	 *   { phase: 'preprocessing', status: 'complete' },
	 *   { itemsProcessed: 1000, timeElapsed: 5.2 }
	 * );
	 */
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

	/**
	 * Adds feedback to a trace from users.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param feedback - Feedback object containing score and optional comment
	 * @param feedback.score - Numerical score for the trace
	 * @param feedback.comment - Optional textual feedback
	 * @returns void
	 * @example
	 * logger.traceFeedback('trace-123', {
	 *   score: 4,
	 *   comment: 'Good results but could be faster'
	 * });
	 */
	public traceFeedback(traceId: string, feedback: { score: number; comment?: string }) {
		Trace.feedback_(this.writer, traceId, feedback);
	}

	/**
	 * Adds metadata to a trace for additional context and debugging.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @param metadata - Key-value pairs of metadata
	 * @returns void
	 * @example
	 * logger.traceMetadata('trace-123', {
	 *   requestId: 'req-456',
	 *   userAgent: 'Mozilla/5.0...',
	 *   processingTime: 1500
	 * });
	 */
	public traceMetadata(traceId: string, metadata: Record<string, unknown>) {
		Trace.addMetadata_(this.writer, Entity.TRACE, traceId, metadata);
	}

	/**
	 * Gets the evaluation methods for a trace.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @returns Evaluation methods for configuring and triggering evaluations on the trace
	 * @example
	 * logger.traceEvaluate('trace-123')
	 *   .withEvaluators('bias', 'toxicity')
	 *   .withVariables({ context: 'user_query', expected: 'gold_standard' });
	 */
	public traceEvaluate(traceId: string) {
		return Trace.evaluate_(this.writer, Entity.TRACE, traceId);
	}

	/**
	 * Ends a trace and records the end timestamp.
	 *
	 * @param traceId - The unique identifier of the trace
	 * @returns void
	 * @example
	 * logger.traceEnd('trace-123');
	 */
	public traceEnd(traceId: string, data?: any) {
		Trace.end_(this.writer, Entity.TRACE, traceId, data);
	}

	// Generation methods

	/**
	 * Updates the model being used for a generation.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @param model - The new model name or identifier
	 * @returns void
	 * @example
	 * logger.generationSetModel('gen-123', 'gpt-4-turbo');
	 */
	public generationSetModel(generationId: string, model: string) {
		Generation.setModel_(this.writer, generationId, model);
	}
	
	public generationSetName(generationId: string, name: string) {
		Generation.setName_(this.writer, generationId, name);
	}

	/**
	 * Adds a tag to a generation for categorization and filtering.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @param key - The tag key
	 * @param value - The tag value
	 * @returns void
	 * @example
	 * logger.generationAddTag('gen-123', 'type', 'chat_completion');
	 * logger.generationAddTag('gen-123', 'use_case', 'customer_support');
	 */
	public generationAddTag(generationId: string, key: string, value: string) {
		Generation.addTag_(this.writer, Entity.GENERATION, generationId, key, value);
	}

	/**
	 * Adds additional messages to a generation's conversation.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @param messages - Array of messages to add
	 * @returns void
	 * @example
	 * logger.generationAddMessage('gen-123', [
	 *   { role: 'user', content: 'Can you clarify that?' }
	 * ]);
	 */
	public generationAddMessage(generationId: string, messages: (CompletionRequest | ChatCompletionMessage)[]) {
		Generation.addMessages_(this.writer, generationId, messages);
	}

	/**
	 * Updates the model parameters for a generation.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @param modelParameters - Object containing model-specific parameters
	 * @returns void
	 * @example
	 * logger.generationSetModelParameters('gen-123', {
	 *   temperature: 0.9,
	 *   max_tokens: 500,
	 *   top_p: 0.95
	 * });
	 */
	public generationSetModelParameters(generationId: string, modelParameters: Record<string, any>) {
		Generation.setModelParameters_(this.writer, generationId, modelParameters);
	}

	/**
	 * Adds a numeric metric to a generation.
	 *
	 * Records quantitative values such as generation quality metrics, token accounting,
	 * and streaming/throughput characteristics under a named metric.
	 *
	 * Common examples include: `tokens_in`, `tokens_out`, `output_tokens`, `ttft_ms` (Time To First Token),
	 * `tps` (tokens per second), `avg_logprob`.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @param name - Name of the metric
	 * @param value - Numeric value of the metric (numeric)
	 * @returns void
	 * @example
	 * logger.generationAddMetric('gen-123', 'output_tokens', 87);
	 * logger.generationAddMetric('gen-123', 'ttft_ms', 180.5);
	 * logger.generationAddMetric('gen-123', 'tps', 15.8);
	 * logger.generationAddMetric('gen-123', 'avg_logprob', -0.32);
	 */
	public generationAddMetric(generationId: string, name: string, value: number) {
		Generation.addMetric_(this.writer, generationId, name, value);
	}

	/**
	 * Records the successful result of a generation and ends it.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @param result - The completion result from the LLM
	 * @returns void
	 * @example
	 * logger.generationResult('gen-123', {
	 *   id: 'cmpl-456',
	 *   object: 'chat.completion',
	 *   created: Date.now(),
	 *   model: 'gpt-4',
	 *   choices: [{
	 *     index: 0,
	 *     message: { role: 'assistant', content: 'Hello! How can I help?' },
	 *     finish_reason: 'stop',
	 *     logprobs: null
	 *   }],
	 *   usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }
	 * });
	 */
	public generationResult(generationId: string, result: TextCompletionResult | ChatCompletionResult) {
		Generation.result_(this.writer, generationId, result);
	}

	/**
	 * Records an error that occurred during a generation.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @param error - Error information including message, code, and type
	 * @returns void
	 * @example
	 * logger.generationError('gen-123', {
	 *   message: 'API request timed out',
	 *   code: 'TIMEOUT_ERROR',
	 *   type: 'NetworkError'
	 * });
	 */
	public generationError(generationId: string, error: GenerationError) {
		Generation.error_(this.writer, generationId, error);
	}

	/**
	 * Adds metadata to a generation for additional context and debugging.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @param metadata - Key-value pairs of metadata
	 * @returns void
	 * @example
	 * logger.generationMetadata('gen-123', {
	 *   requestId: 'req-789',
	 *   latency: 1200,
	 *   tokensPerSecond: 15.5
	 * });
	 */
	public generationMetadata(generationId: string, metadata: Record<string, unknown>) {
		Generation.addMetadata_(this.writer, Entity.GENERATION, generationId, metadata);
	}

	/**
	 * Gets the evaluation methods for a generation.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @returns Evaluation methods for configuring and triggering evaluations on the generation
	 * @example
	 * logger.generationEvaluate('gen-123')
	 *   .withEvaluators('bias', 'toxicity')
	 *   .withVariables({ expected_output: 'The correct answer' });
	 */
	public generationEvaluate(generationId: string) {
		return Generation.evaluate_(this.writer, Entity.GENERATION, generationId);
	}

	/**
	 * Ends a generation and records the end timestamp.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @returns void
	 * @example
	 * logger.generationEnd('gen-123');
	 */
	public generationEnd(generationId: string, data?: any) {
		Generation.end_(this.writer, Entity.GENERATION, generationId, data);
	}

	/**
	 * Adds an attachment to this generation.
	 *
	 * @param generationId - The unique identifier of the generation
	 * @param attachment - The attachment to add (can be of type file, data, or URL)
	 * @returns void
	 * @example
	 * logger.generationAddAttachment('gen-123',{
	 *   id: 'input-document',
	 *   type: 'file',
	 *   path: './uploads/document.pdf',
	 *   tags: { category: 'input' }
	 * });
	 */
	public generationAddAttachment(generationId: string, attachment: Attachment) {
		return Generation.addAttachment_(this.writer, generationId, attachment);
	}

	// Span methods

	/**
	 * Creates a new generation (LLM call) associated with a span.
	 *
	 * @param spanId - The unique identifier of the span
	 * @param config - Configuration for the generation
	 * @returns A new generation instance associated with the span
	 * @example
	 * const generation = logger.spanGeneration('span-123', {
	 *   id: 'gen-001',
	 *   provider: 'openai',
	 *   model: 'gpt-4',
	 *   messages: [{ role: 'user', content: 'Process this data' }],
	 *   modelParameters: { temperature: 0.1 }
	 * });
	 */
	public spanGeneration(spanId: string, config: GenerationConfig) {
		return Span.generation_(this.writer, spanId, config);
	}

	/**
	 * Creates a new retrieval associated with a span.
	 *
	 * @param spanId - The unique identifier of the span
	 * @param config - Configuration for the retrieval
	 * @returns A new retrieval instance associated with the span
	 * @example
	 * const retrieval = logger.spanRetrieval('span-123', {
	 *   id: 'retrieval-001',
	 *   name: 'Context Database Lookup'
	 * });
	 */
	public spanRetrieval(spanId: string, config: RetrievalConfig) {
		return Span.retrieval_(this.writer, spanId, config);
	}

	/**
	 * Creates a new tool call associated with a span.
	 *
	 * @param spanId - The unique identifier of the span
	 * @param config - Configuration for the tool call
	 * @returns A new tool call instance associated with the span
	 * @example
	 * const toolCall = logger.spanToolCall('span-123', {
	 *   id: 'tool-001',
	 *   name: 'api_call',
	 *   description: 'Fetch data from external service',
	 *   args: JSON.stringify({ endpoint: '/users', id: 123 })
	 * });
	 */
	public spanToolCall(spanId: string, config: ToolCallConfig) {
		return Span.toolCall_(this.writer, spanId, config);
	}

	/**
	 * Creates a nested span within a span for hierarchical organization.
	 *
	 * @param spanId - The unique identifier of the parent span
	 * @param config - Configuration for the nested span
	 * @returns A new nested span instance
	 * @example
	 * const childSpan = logger.spanSpan('span-123', {
	 *   id: 'child-span-001',
	 *   name: 'Data Validation Step'
	 * });
	 */
	public spanSpan(spanId: string, config: SpanConfig) {
		return Span.span_(this.writer, spanId, config);
	}

	/**
	 * Adds a tag to a span for categorization and filtering.
	 *
	 * @param spanId - The unique identifier of the span
	 * @param key - The tag key
	 * @param value - The tag value
	 * @returns void
	 * @example
	 * logger.spanTag('span-123', 'phase', 'preprocessing');
	 * logger.spanTag('span-123', 'status', 'in_progress');
	 */
	public spanTag(spanId: string, key: string, value: string) {
		return Span.addTag_(this.writer, Entity.SPAN, spanId, key, value);
	}

	/**
	 * Creates an error associated with a span.
	 *
	 * @param spanId - The unique identifier of the span
	 * @param config - Configuration for the error
	 * @returns A new error instance associated with the span
	 * @example
	 * const error = logger.spanError('span-123', {
	 *   id: 'error-001',
	 *   message: 'Validation failed',
	 *   code: 'VALIDATION_ERROR',
	 *   type: 'ValidationError'
	 * });
	 */
	public spanError(spanId: string, config: ErrorConfig): MaximError {
		return Span.error_(this.writer, spanId, config);
	}

	/**
	 * Emits a custom event within a span.
	 *
	 * @param spanId - The unique identifier of the span
	 * @param eventId - Unique identifier for the event
	 * @param eventName - Human-readable name for the event
	 * @param tags - Optional tags for categorizing the event
	 * @param metadata - Optional metadata for additional context
	 * @returns void
	 * @example
	 * logger.spanEvent(
	 *   'span-123',
	 *   'validation-complete',
	 *   'Data Validation Complete',
	 *   { status: 'success', records: '1000' },
	 *   { validationTime: 250, errorsFound: 0 }
	 * );
	 */
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

	/**
	 * Adds metadata to a span for additional context and debugging.
	 *
	 * @param spanId - The unique identifier of the span
	 * @param metadata - Key-value pairs of metadata
	 * @returns void
	 * @example
	 * logger.spanMetadata('span-123', {
	 *   processingTime: 500,
	 *   itemsProcessed: 250,
	 *   memoryUsage: '128MB'
	 * });
	 */
	public spanMetadata(spanId: string, metadata: Record<string, unknown>) {
		return Span.addMetadata_(this.writer, Entity.SPAN, spanId, metadata);
	}

	/**
	 * Gets the evaluation methods for a span.
	 *
	 * @param spanId - The unique identifier of the span
	 * @returns Evaluation methods for configuring and triggering evaluations on the span
	 * @example
	 * logger.spanEvaluate('span-123')
	 *   .withEvaluators('performance', 'accuracy')
	 *   .withVariables({ expected_output: 'target_result' });
	 */
	public spanEvaluate(spanId: string) {
		return Span.evaluate_(this.writer, Entity.SPAN, spanId);
	}

	/**
	 * Ends a span and records the end timestamp.
	 *
	 * @param spanId - The unique identifier of the span
	 * @returns void
	 * @example
	 * logger.spanEnd('span-123');
	 */
	public spanEnd(spanId: string, data?: any) {
		return Span.end_(this.writer, Entity.SPAN, spanId, data);
	}

	/**
	 * Adds an attachment to this span.
	 *
	 * @param spanId - The unique identifier of the span
	 * @param attachment - The attachment to add (can be of type file, data, or URL)
	 * @returns void
	 * @example
	 * logger.spanAddAttachment('span-123',{
	 *   id: 'input-document',
	 *   type: 'file',
	 *   path: './uploads/document.pdf',
	 *   tags: { category: 'input' }
	 * });
	 */
	public spanAddAttachment(spanId: string, attachment: Attachment) {
		return Span.addAttachment_(this.writer, spanId, attachment);
	}

	// Retrieval methods

	/**
	 * Ends a retrieval and records the end timestamp.
	 *
	 * @param retrievalId - The unique identifier of the retrieval
	 * @returns void
	 * @example
	 * logger.retrievalEnd('retrieval-123');
	 */
	public retrievalEnd(retrievalId: string) {
		Retrieval.end_(this.writer, Entity.RETRIEVAL, retrievalId);
	}

	/**
	 * Adds a tag to a retrieval for categorization and filtering.
	 *
	 * @param retrievalId - The unique identifier of the retrieval
	 * @param key - The tag key
	 * @param value - The tag value
	 * @returns void
	 * @example
	 * logger.retrievalAddTag('retrieval-123', 'source', 'knowledge_base');
	 * logger.retrievalAddTag('retrieval-123', 'query_type', 'semantic');
	 */
	public retrievalAddTag(retrievalId: string, key: string, value: string) {
		Retrieval.addTag_(this.writer, Entity.RETRIEVAL, retrievalId, key, value);
	}

	/**
	 * Sets the input query for a retrieval operation.
	 *
	 * @param retrievalId - The unique identifier of the retrieval
	 * @param input - The search query or input text
	 * @returns void
	 * @example
	 * logger.retrievalInput('retrieval-123', 'How do I troubleshoot network issues?');
	 */
	public retrievalInput(retrievalId: string, input: string) {
		Retrieval.input_(this.writer, retrievalId, input);
	}

	/**
	 * Adds a numeric metric to a retrieval.
	 *
	 * Records quantitative values used in information retrieval and RAG evaluation under a
	 * named metric.
	 *
	 * Common examples include: `precision`, `recall`, `f1_score`, `mrr` (Mean Reciprocal Rank),
	 * `ndcg` (Normalized Discounted Cumulative Gain), `avg_similarity`, `results_count`,
	 * `unique_sources_count`.
	 *
	 * @param retrievalId - The unique identifier of the retrieval
	 * @param name - Name of the metric
	 * @param value - Numeric value of the metric (numeric)
	 * @returns void
	 * @example
	 * logger.retrievalAddMetric('retrieval-123', 'precision', 0.86);
	 * logger.retrievalAddMetric('retrieval-123', 'mrr', 0.58);
	 */
	public retrievalAddMetric(retrievalId: string, name: string, value: number) {
		Retrieval.addMetric_(this.writer, retrievalId, name, value);
	}

	/**
	 * Sets the output results for a retrieval operation and ends it.
	 *
	 * @param retrievalId - The unique identifier of the retrieval
	 * @param output - Retrieved documents as a single string or array
	 * @returns void
	 * @example
	 * // Single result
	 * logger.retrievalOutput('retrieval-123', 'Network troubleshooting guide: First, check cables...');
	 *
	 * @example
	 * // Multiple results
	 * logger.retrievalOutput('retrieval-123', [
	 *   'Document 1: Basic troubleshooting steps...',
	 *   'Document 2: Advanced network diagnostics...'
	 * ]);
	 */
	public retrievalOutput(retrievalId: string, output: string | string[]) {
		Retrieval.output_(this.writer, retrievalId, output);
	}

	/**
	 * Adds metadata to a retrieval for additional context and debugging.
	 *
	 * @param retrievalId - The unique identifier of the retrieval
	 * @param metadata - Key-value pairs of metadata
	 * @returns void
	 * @example
	 * logger.retrievalMetadata('retrieval-123', {
	 *   searchTime: 150,
	 *   resultsCount: 5,
	 *   similarityThreshold: 0.85
	 * });
	 */
	public retrievalMetadata(retrievalId: string, metadata: Record<string, unknown>) {
		return Retrieval.addMetadata_(this.writer, Entity.RETRIEVAL, retrievalId, metadata);
	}

	/**
	 * Gets the evaluation methods for a retrieval.
	 *
	 * @param retrievalId - The unique identifier of the retrieval
	 * @returns Evaluation methods for configuring and triggering evaluations on the retrieval
	 * @example
	 * logger.retrievalEvaluate('retrieval-123')
	 *   .withEvaluators('relevance', 'recall')
	 *   .withVariables({ context: 'user_query', expected: 'ground_truth' });
	 */
	public retrievalEvaluate(retrievalId: string) {
		return Retrieval.evaluate_(this.writer, Entity.RETRIEVAL, retrievalId);
	}

	// Tool call methods

	/**
	 * Records the successful result of a tool call and ends it.
	 *
	 * @param toolCallId - The unique identifier of the tool call
	 * @param result - The result returned by the tool as a string
	 * @returns void
	 * @example
	 * logger.toolCallResult('tool-123', JSON.stringify({
	 *   userId: '12345',
	 *   name: 'John Doe',
	 *   email: 'john@example.com'
	 * }));
	 */
	public toolCallResult(toolCallId: string, result: string) {
		return ToolCall.result_(this.writer, toolCallId, result);
	}

	/**
	 * Records an error that occurred during a tool call and ends it.
	 *
	 * @param toolCallId - The unique identifier of the tool call
	 * @param error - Error information including message, code, and type
	 * @returns void
	 * @example
	 * logger.toolCallError('tool-123', {
	 *   message: 'Database connection failed',
	 *   code: 'DB_CONNECTION_ERROR',
	 *   type: 'DatabaseError'
	 * });
	 */
	public toolCallError(toolCallId: string, error: ToolCallError) {
		return ToolCall.error_(this.writer, toolCallId, error);
	}

	/**
	 * Adds a tag to a tool call for categorization and filtering.
	 *
	 * @param toolCallId - The unique identifier of the tool call
	 * @param key - The tag key
	 * @param value - The tag value
	 * @returns void
	 * @example
	 * logger.toolCallAddTag('tool-123', 'category', 'database');
	 * logger.toolCallAddTag('tool-123', 'priority', 'high');
	 */
	public toolCallAddTag(toolCallId: string, key: string, value: string) {
		ToolCall.addTag_(this.writer, Entity.TOOL_CALL, toolCallId, key, value);
	}

	/**
	 * Adds metadata to a tool call for additional context and debugging.
	 *
	 * @param toolCallId - The unique identifier of the tool call
	 * @param metadata - Key-value pairs of metadata
	 * @returns void
	 * @example
	 * logger.toolCallMetadata('tool-123', {
	 *   executionTime: 350,
	 *   apiEndpoint: '/api/v1/users',
	 *   responseSize: 1024
	 * });
	 */
	public toolCallMetadata(toolCallId: string, metadata: Record<string, unknown>) {
		return ToolCall.addMetadata_(this.writer, Entity.TOOL_CALL, toolCallId, metadata);
	}

	/**
	 * Flushes all pending logs to the backend immediately.
	 *
	 * Forces the log writer to send all queued logs to the Maxim backend
	 * without waiting for the automatic flush interval.
	 *
	 * @returns void
	 * @example
	 * // Force flush before critical operation
	 * logger.flush();
	 */
	public async flush() {
		await this.writer.flush();
	}
}
