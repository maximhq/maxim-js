import { LogWriter } from "../writer";
import { Attachment } from "./attachment";
import { EventEmittingBaseContainer } from "./base";
import { Error, ErrorConfig } from "./error";
import { Generation, GenerationConfig } from "./generation";
import { Retrieval, RetrievalConfig } from "./retrieval";
import { ToolCall, ToolCallConfig } from "./toolCall";
import { Entity } from "./types";

/**
 * Configuration object for span.
 */
export type SpanConfig = {
	id: string;
	name?: string;
	tags?: Record<string, string>;
};

/**
 * Represents a hierarchical span within a trace for grouping.
 *
 * Spans provide fine-grained instrumentation within traces, allowing you to
 * organize sections of complex operations. They can contain
 * all kinds of components within them apart from trace or session (nested spans are allowed).
 *
 * @class Span
 * @extends EventEmittingBaseContainer
 * @example
 * const span = container.span({
 *   id: 'authentication-span',
 *   name: 'User Authentication Process',
 * });
 *
 * // Add operations to the span
 * const generation = span.generation({
 *   id: 'token-validation',
 *   provider: 'internal',
 *   model: 'auth-validator',
 *   messages: [{ role: 'system', content: 'Validate token' }],
 *   modelParameters: {}
 * });
 *
 * @example
 * // Nested spans for complex operations
 * const parentSpan = container.span({
 *   id: 'document-processing',
 *   name: 'Document Analysis Pipeline'
 * });
 *
 * const childSpan = parentSpan.span({
 *   id: 'text-extraction',
 *   name: 'Text Extraction Phase'
 * });
 *
 * const retrieval = childSpan.retrieval({
 *   id: 'knowledge-lookup',
 *   name: 'Knowledge Base Lookup'
 * });
 */
export class Span extends EventEmittingBaseContainer {
	/**
	 * Creates a new span log entry.
	 *
	 * @param config - Configuration object defining the span
	 * @param writer - Log writer instance for persisting span data
	 * @example
	 * const span = container.span({
	 *   id: 'data-validation-span',
	 *   name: 'Input Data Validation',
	 * });
	 */
	constructor(config: SpanConfig, writer: LogWriter) {
		super(Entity.SPAN, config, writer);
		this.commit("create");
	}

	/**
	 * Creates a new generation (LLM call) within this span.
	 *
	 * @param config - Configuration for the generation
	 * @returns A new generation instance associated with this span
	 * @example
	 * const generation = span.generation({
	 *   id: 'validation-check',
	 *   provider: 'openai',
	 *   model: 'gpt-4',
	 *   messages: [{ role: 'user', content: 'Validate this input' }],
	 *   modelParameters: { temperature: 0.1 }
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
	 * Static method to create a generation associated with any span by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The span ID
	 * @param config - Configuration for the generation
	 * @returns A new generation instance
	 */
	public static generation_(writer: LogWriter, id: string, config: GenerationConfig) {
		const generation = new Generation(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "add-generation", {
			id: config.id,
			messages: JSON.parse(JSON.stringify(config.messages)),
			...generation.data(),
		});
		return generation;
	}

	/**
	 * Creates a nested span within this span for hierarchical organization.
	 *
	 * @param config - Configuration for the nested span
	 * @returns A new nested span instance
	 * @example
	 * const childSpan = parentSpan.span({
	 *   id: 'preprocessing-step',
	 *   name: 'Data Preprocessing',
	 * });
	 */
	public span(config: SpanConfig): Span {
		const span = new Span(config, this.writer);
		this.commit("add-span", {
			id: config.id,
			...span.data(),
		});
		return span;
	}

	/**
	 * Static method to create a nested span associated with any span by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The parent span ID
	 * @param config - Configuration for the nested span
	 * @returns A new nested span instance
	 */
	public static span_(writer: LogWriter, id: string, config: SpanConfig) {
		const span = new Span(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "add-span", {
			id: config.id,
			...span.data(),
		});
		return span;
	}

	/**
	 * Creates an error within this span.
	 *
	 * @param config - Configuration for the error
	 * @returns A new error instance associated with this span
	 * @example
	 * const error = span.error({
	 *   id: 'validation-error',
	 *   message: 'Input validation failed',
	 *   code: 'INVALID_INPUT',
	 *   type: 'ValidationError'
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
	 * Static method to create an error associated with any span by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The span ID
	 * @param config - Configuration for the error
	 * @returns A new error instance
	 */
	public static error_(writer: LogWriter, id: string, config: ErrorConfig): Error {
		const error = new Error(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "add-error", {
			id: config.id,
			...error.data(),
		});
		return error;
	}

	/**
	 * Creates a retrieval within this span.
	 *
	 * @param config - Configuration for the retrieval
	 * @returns A new retrieval instance associated with this span
	 * @example
	 * const retrieval = span.retrieval({
	 *   id: 'context-lookup',
	 *   name: 'Context Database Lookup',
	 * });
	 *
	 * retrieval.input('user query context');
	 * retrieval.output(['relevant context 1', 'relevant context 2']);
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
	 * Static method to create a retrieval associated with any span by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The span ID
	 * @param config - Configuration for the retrieval
	 * @returns A new retrieval instance
	 */
	public static retrieval_(writer: LogWriter, id: string, config: RetrievalConfig) {
		const retrieval = new Retrieval(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "add-retrieval", {
			id: config.id,
			...retrieval.data(),
		});
		return retrieval;
	}

	/**
	 * Creates a tool call within this span.
	 *
	 * @param config - Configuration for the tool call
	 * @returns A new tool call instance associated with this span
	 * @example
	 * const toolCall = span.toolCall({
	 *   id: 'api-call',
	 *   name: 'external_api_call',
	 *   description: 'Fetch data from external service',
	 *   args: JSON.stringify({ endpoint: '/users', id: 123 })
	 * });
	 *
	 * toolCall.result('{"name": "John", "email": "john@example.com"}');
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
	 * Static method to create a tool call associated with any span by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The span ID
	 * @param config - Configuration for the tool call
	 * @returns A new tool call instance
	 */
	public static toolCall_(writer: LogWriter, id: string, config: ToolCallConfig) {
		const toolCall = new ToolCall(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "add-tool-call", {
			id: config.id,
			...toolCall.data(),
		});
		return toolCall;
	}

	/**
	 * Adds an attachment to this span.
	 *
	 * @param attachment - The attachment to add (file, data, or URL)
	 * @returns void
	 * @example
	 * span.addAttachment({
	 *   id: 'processing-result',
	 *   type: 'file',
	 *   path: './output/processed_data.json',
	 *   name: 'Processing Results'
	 * });
	 */
	public addAttachment(attachment: Attachment) {
		this.commit("upload-attachment", attachment);
	}

	/**
	 * Static method to add an attachment to any span by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The span ID
	 * @param attachment - The attachment to add
	 * @returns void
	 */
	public static addAttachment_(writer: LogWriter, id: string, attachment: Attachment) {
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "upload-attachment", attachment);
	}
}
