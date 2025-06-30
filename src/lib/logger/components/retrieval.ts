import { utcNow } from "../utils";
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
		this.commit("end", { docs: finalDocs, endTimestamp: utcNow() });
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
		EvaluatableBaseContainer.commit_(writer, Entity.RETRIEVAL, id, "end", { docs: finalDocs, endTimestamp: utcNow() });
	}
}
