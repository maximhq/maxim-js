import type { Attachment } from "../../types";
import { LogWriter } from "../writer";
import { EventEmittingBaseContainer } from "./base";
import { Error, ErrorConfig } from "./error";
import { Generation, GenerationConfig } from "./generation";
import { Retrieval, RetrievalConfig } from "./retrieval";
import { Span, SpanConfig } from "./span";
import { ToolCall, ToolCallConfig } from "./toolCall";
import { Entity } from "./types";

/**
 * Configuration object for trace.
 */
export type TraceConfig = {
	id: string;
	name?: string;
	sessionId?: string;
	tags?: Record<string, string>;
	/**
	 * Optional explicit start timestamp. If not provided, defaults to current time.
	 */
	startTimestamp?: Date;
	/**
	 * Optional explicit end timestamp. Can be set during creation for completed operations.
	 */
	endTimestamp?: Date;
};

/**
 * Represents a trace (a single turn interaction).
 *
 * Traces capture the complete execution flow of operations, including generations,
 * tool calls, retrievals, spans, and errors happening within one user interaction
 * turn. They provide detailed timing and hierarchical organization of activities
 * within a session or standalone operation.
 *
 * @class Trace
 * @extends EventEmittingBaseContainer
 * @example
 * const trace = logger.trace({
 *   id: 'query-processing-trace',
 *   name: 'User Query Processing',
 *   sessionId: 'chat-session-001', // optional
 * });
 *
 * // Add input
 * trace.input('Find information about machine learning');
 *
 * // Adding components to trace
 * const generation = trace.generation({
 *   id: 'llm-generation-001',
 *   provider: 'openai',
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Explain ML' }],
 *   modelParameters: { temperature: 0.7 }
 * });
 *
 * const retrieval = trace.retrieval({
 *   id: 'vector-search-001',
 *   name: 'Knowledge Base Search'
 * });
 *
 * const toolCall = trace.toolCall({
 *   id: 'search-tool-001',
 *   name: 'external_search',
 *   description: 'Search external knowledge base',
 *   args: JSON.stringify({ query: 'machine learning' })
 * });
 *
 * // Add output
 * trace.output('Machine learning is a subset of artificial intelligence...');
 */
export class Trace extends EventEmittingBaseContainer {
	/**
	 * Creates a new trace log entry.
	 *
	 * @param config - Configuration object defining the trace
	 * @param writer - Log writer instance for persisting trace data
	 * @example
	 * const trace = new Trace({
	 *   id: 'recommendation-trace',
	 *   name: 'Product Recommendation Flow',
	 *   sessionId: 'shopping-session-456',
	 * });
	 */
	constructor(config: TraceConfig, writer: LogWriter) {
		super(Entity.TRACE, config, writer);
		this.commit("create", {
			...this.data(),
			sessionId: config.sessionId,
		});
	}

	/**
	 * Creates a new generation (LLM call) within this trace.
	 *
	 * @param config - Configuration for the generation
	 * @returns A new generation instance associated with this trace
	 * @example
	 * const generation = trace.generation({
	 *   id: 'summary-generation',
	 *   provider: 'openai',
	 *   model: 'gpt-4',
	 *   messages: [
	 *     { role: 'system', content: 'Summarize the following text.' },
	 *     { role: 'user', content: 'Long article content...' }
	 *   ],
	 *   modelParameters: { temperature: 0.3, max_tokens: 150 }
	 * });
	 */
	public generation(config: GenerationConfig): Generation {
		const generation = new Generation(config, this.writer);
		this.commit("add-generation", {
			id: config.id,
			messages: JSON.parse(JSON.stringify(config.messages)),
			...generation.data(),
		});
		return generation;
	}

	/**
	 * Static method to create a generation associated with any trace by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param config - Configuration for the generation
	 * @returns A new generation instance
	 */
	public static generation_(writer: LogWriter, id: string, config: GenerationConfig) {
		const generation = new Generation(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-generation", {
			id: config.id,
			messages: JSON.parse(JSON.stringify(config.messages)),
			...generation.data(),
		});
		return generation;
	}

	/**
	 * Associates this trace with a session.
	 *
	 * @param sessionId - The ID of the session to associate with
	 * @returns void
	 * @example
	 * trace.addToSession('user-session-789');
	 */
	public addToSession(sessionId: string) {
		this.commit("update", { sessionId });
	}

	/**
	 * Static method to associate any trace with a session by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param sessionId - The session ID to associate with
	 * @returns void
	 */
	public static addToSession_(writer: LogWriter, id: string, sessionId: string) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "update", { sessionId });
	}

	/**
	 * Adds feedback to this trace from users.
	 *
	 * @param feedback - Feedback object containing score and optional comment
	 * @param feedback.score - Numerical score for the trace
	 * @param feedback.comment - Optional textual feedback
	 * @returns void
	 * @example
	 * trace.feedback({
	 *   score: 4,
	 *   comment: 'Good results but could be faster'
	 * });
	 */
	public feedback(feedback: { score: number; comment?: string }) {
		this.commit("add-feedback", feedback);
	}

	/**
	 * Static method to add feedback to any trace by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param feedback - Feedback object
	 * @param feedback.score - Numerical score for the trace
	 * @param feedback.comment - Optional textual feedback
	 * @returns void
	 */
	public static feedback_(writer: LogWriter, id: string, feedback: { score: number; comment?: string }) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-feedback", feedback);
	}

	/**
	 * Adds a numeric metric to this trace.
	 *
	 * Records quantitative values such as tool call counts, retry attempts, total tokens,
	 * overall cost, or aggregated evaluation scores under a named metric. Each call adds
	 * or updates a single metric entry.
	 *
	 * Common examples include: `tool_calls_count`, `retries_count`, `cost_usd`, `tokens_total`,
	 * `eval_overall_score`, `user_feedback_score`.
	 *
	 * @param name - Name of the metric
	 * @param value - Numeric value of the metric (numeric)
	 * @returns void
	 * @example
	 * trace.addMetric('tool_calls_count', 3);
	 * trace.addMetric('cost_usd', 0.05);
	 * trace.addMetric('tokens_total', 1420);
	 * trace.addMetric('user_feedback_score', 4.7);
	 */
	public addMetric(name: string, value: number) {
		this.commit("update", { metrics: { [name]: value } });
	}

	/**
	 * Static method to add a metric to any trace by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param name - Name of the metric
	 * @param value - Numeric value of the metric (float/number)
	 * @returns void
	 */
	public static addMetric_(writer: LogWriter, id: string, name: string, value: number) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "update", { metrics: { [name]: value } });
	}

	/**
	 * Adds an attachment to this trace.
	 *
	 * @param attachment - The attachment to add (can be of type file, data, or URL)
	 * @returns void
	 * @example
	 * trace.addAttachment({
	 *   id: 'input-document',
	 *   type: 'file',
	 *   path: './uploads/document.pdf',
	 *   tags: { category: 'input' }
	 * });
	 */
	public addAttachment(attachment: Attachment) {
		this.commit("upload-attachment", attachment);
	}

	/**
	 * Static method to add an attachment to any trace by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param attachment - The attachment to add
	 * @returns void
	 */
	public static addAttachment_(writer: LogWriter, id: string, attachment: Attachment) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "upload-attachment", attachment);
	}

	/**
	 * Creates a new span within this trace for hierarchical organization.
	 *
	 * @param config - Configuration for the span
	 * @returns A new span instance associated with this trace
	 * @example
	 * const span = trace.span({
	 *   id: 'data-processing-span',
	 *   name: 'Data Processing Pipeline',
	 * });
	 */
	public span(config: SpanConfig): Span {
		const span = new Span(config, this.writer);
		this.commit("add-span", {
			id: span.id,
			...span.data(),
		});
		return span;
	}

	/**
	 * Static method to create a span associated with any trace by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param config - Configuration for the span
	 * @returns A new span instance
	 */
	public static span_(writer: LogWriter, id: string, config: SpanConfig) {
		const span = new Span(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-span", {
			id: span.id,
			...span.data(),
		});
		return span;
	}

	/**
	 * Creates an error within this trace.
	 *
	 * @param config - Configuration for the error
	 * @returns A new error instance associated with this trace
	 * @example
	 * const error = trace.error({
	 *   id: 'processing-error',
	 *   message: 'Failed to process user input',
	 *   code: 'PROCESSING_FAILED',
	 *   type: 'ProcessingError'
	 * });
	 */
	public error(config: ErrorConfig): Error {
		const error = new Error(config, this.writer);
		this.commit("add-error", {
			id: config.id,
			...error.data(),
		});
		return error;
	}

	/**
	 * Static method to create an error associated with any trace by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param config - Configuration for the error
	 * @returns A new error instance
	 */
	public static error_(writer: LogWriter, id: string, config: ErrorConfig) {
		const error = new Error(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-error", {
			id: config.id,
			...error.data(),
		});
		return error;
	}

	/**
	 * Creates a tool call within this trace.
	 *
	 * @param config - Configuration for the tool call
	 * @returns A new tool call instance associated with this trace
	 * @example
	 * const toolCall = trace.toolCall({
	 *   id: 'calculator-tool',
	 *   name: 'calculate',
	 *   description: 'Perform mathematical calculations',
	 *   args: JSON.stringify({ expression: '2 + 2' })
	 * });
	 */
	public toolCall(config: ToolCallConfig) {
		const toolCall = new ToolCall(config, this.writer);
		this.commit("add-tool-call", {
			id: config.id,
			...toolCall.data(),
		});
		return toolCall;
	}

	/**
	 * Static method to create a tool call associated with any trace by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param config - Configuration for the tool call
	 * @returns A new tool call instance
	 */
	public static toolCall_(writer: LogWriter, id: string, config: ToolCallConfig) {
		const toolCall = new ToolCall(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-tool-call", {
			id: toolCall.id,
			...toolCall.data(),
		});
		return toolCall;
	}

	/**
	 * Creates a retrieval within this trace.
	 *
	 * @param config - Configuration for the retrieval
	 * @returns A new retrieval instance associated with this trace
	 * @example
	 * const retrieval = trace.retrieval({
	 *   id: 'knowledge-search',
	 *   name: 'Knowledge Base Search'
	 * });
	 */
	public retrieval(config: RetrievalConfig): Retrieval {
		const retrieval = new Retrieval(config, this.writer);
		this.commit("add-retrieval", {
			id: config.id,
			...retrieval.data(),
		});
		return retrieval;
	}

	/**
	 * Static method to create a retrieval associated with any trace by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param config - Configuration for the retrieval
	 * @returns A new retrieval instance
	 */
	public static retrieval_(writer: LogWriter, id: string, config: RetrievalConfig) {
		const retrieval = new Retrieval(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-retrieval", {
			id: config.id,
			...retrieval.data(),
		});
		return retrieval;
	}

	/**
	 * Sets the input for this trace.
	 *
	 * @param input - The input that for this trace
	 * @returns This trace instance for method chaining
	 * @example
	 * trace.input('Analyze this customer feedback: "The product is great but shipping was slow"');
	 */
	public input(input: string): Trace {
		this.commit("update", { input });
		return this;
	}

	/**
	 * Static method to set input for any trace by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param input - The input for the trace
	 * @returns void
	 */
	public static input_(writer: LogWriter, id: string, input: string) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "update", {
			input: input,
		});
	}

	/**
	 * Sets the output for this trace.
	 *
	 * @param output - The final output or result of this trace execution
	 * @returns This trace instance for method chaining
	 * @example
	 * trace.output('Sentiment: Positive (0.7), Issues: Shipping delay, Action: Contact logistics team');
	 */
	public output(output: string): Trace {
		this.commit("update", { output });
		return this;
	}

	/**
	 * Static method to set output for any trace by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The trace ID
	 * @param output - The output for the trace
	 * @returns void
	 */
	public static output_(writer: LogWriter, id: string, output: string) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "update", {
			output: output,
		});
	}
}
