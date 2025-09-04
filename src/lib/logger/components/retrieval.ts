import { LogWriter } from "../writer";
import { EvaluatableBaseContainer } from "./base";
import { Entity } from "./types";

/**
 * Configuration object for retrieval.
 */
export type RetrievalConfig = {
	id: string;
	name?: string;
	tags?: Record<string, string>;
};

/**
 * Represents a retrieval.
 *
 * Retrieval operations capture the process of searching, querying, or fetching
 * relevant information from databases, vector stores, knowledge bases, or other
 * data sources. Essential for RAG (Retrieval-Augmented Generation) applications.
 *
 * @class Retrieval
 * @extends EvaluatableBaseContainer
 * @example
 * const retrieval = container.retrieval({
 *   id: 'faq-search-001',
 *   name: 'FAQ Knowledge Search',
 * });
 *
 * // Set the search query
 * retrieval.input('How do I reset my password?');
 *
 * // Record the retrieved documents
 * retrieval.output([
 *   'To reset your password, go to Settings > Security...',
 *   'Password requirements: minimum 8 characters...',
 *   'If you forgot your password, click "Forgot Password"...'
 * ]);
 */
export class Retrieval extends EvaluatableBaseContainer {
	/**
	 * Creates a new retrieval log entry.
	 *
	 * @param config - Configuration object defining the retrieval
	 * @param writer - Log writer instance for persisting retrieval data
	 * @example
	 * const retrieval = container.retrieval({
	 *   id: 'knowledge-search-001',
	 *   name: 'Product Knowledge Base Search',
	 * });
	 */
	constructor(config: RetrievalConfig, writer: LogWriter) {
		super(Entity.RETRIEVAL, config, writer);
	}

	/**
	 * Sets the input query for this retrieval operation.
	 *
	 * @param query - The search query or input text
	 * @returns void
	 * @example
	 * retrieval.input('How do I troubleshoot connection issues?');
	 */
	public input(query: string) {
		this.commit("update", { input: query });
	}

	/**
	 * Static method to set input for any retrieval by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The retrieval ID
	 * @param query - The search query or input text
	 * @returns void
	 */
	public static input_(writer: LogWriter, id: string, query: string) {
		EvaluatableBaseContainer.commit_(writer, Entity.RETRIEVAL, id, "update", { input: query });
	}

	/**
	 * Sets the output results for this retrieval operation and ends it.
	 *
	 * @param docs - Retrieved documents as a single string or array
	 * @returns void
	 * @example
	 * // Single result
	 * retrieval.output('Connection troubleshooting guide: First, check cables...');
	 *
	 * @example
	 * // Multiple results
	 * retrieval.output([
	 *   'Document 1: Basic troubleshooting steps...',
	 *   'Document 2: Advanced network diagnostics...',
	 *   'Document 3: Common error codes and solutions...'
	 * ]);
	 */
	public output(docs: string | string[]) {
		let finalDocs = docs;
		if (typeof docs === "string") {
			finalDocs = [docs];
		}
		this.commit("end", { docs: finalDocs, endTimestamp: new Date() });
		this.end();
	}

	/**
	 * Static method to set output for any retrieval by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The retrieval ID
	 * @param docs - Retrieved documents as a single string or array
	 * @returns void
	 */
	public static output_(writer: LogWriter, id: string, docs: string | string[]) {
		let finalDocs = docs;
		if (typeof docs === "string") {
			finalDocs = [docs];
		}
		EvaluatableBaseContainer.commit_(writer, Entity.RETRIEVAL, id, "end", { docs: finalDocs, endTimestamp: new Date() });
	}

	/**
	 * Adds a numeric metric to this retrieval.
	 *
	 * Records quantitative values used in information retrieval and RAG evaluation under a
	 * named metric. Each call adds or updates a single metric entry.
	 *
	 * Common examples include: `precision`, `recall`, `f1_score`, `mrr` (Mean Reciprocal Rank),
	 * `ndcg` (Normalized Discounted Cumulative Gain), `avg_similarity`, `results_count`,
	 * `unique_sources_count`.
	 *
	 * @param name - Name of the metric
	 * @param value - Numeric value of the metric (numeric)
	 * @returns void
	 * @example
	 * retrieval.addMetric('precision', 0.82);
	 * retrieval.addMetric('recall', 0.76);
	 * retrieval.addMetric('mrr', 0.61);
	 * retrieval.addMetric('results_count', 10);
	 */
	public addMetric(name: string, value: number) {
		this.commit("update", { metrics: { [name]: value } });
	}

	/**
	 * Static method to add a metric to any retrieval by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The retrieval ID
	 * @param name - Name of the metric
	 * @param value - Numeric value of the metric (float/number)
	 * @returns void
	 */
	public static addMetric_(writer: LogWriter, id: string, name: string, value: number) {
		EvaluatableBaseContainer.commit_(writer, Entity.RETRIEVAL, id, "update", { metrics: { [name]: value } });
	}
}
