import { LogWriter } from "../writer";
import { EvaluatableBaseContainer } from "./base";
import { Trace, TraceConfig } from "./trace";
import { Entity } from "./types";

/**
 * Configuration object for session.
 */
export type SessionConfig = {
	id: string;
	name?: string;
	tags?: Record<string, string>;
};

/**
 * Represents a user or system session containing multiple traces (back and forth interactions).
 *
 * Sessions provide a high-level grouping mechanism for related activities,
 * typically representing a user interaction session, conversation, etc.
 * Sessions can contain multiple traces and support feedback collection.
 *
 * @class Session
 * @extends EvaluatableBaseContainer
 * @example
 * const session = logger.session({
 *   id: 'chat-session-001',
 *   name: 'Customer Support Session',
 * });
 *
 * // Add traces to the session
 * const trace = session.trace({
 *   id: 'query-trace-001',
 *   name: 'User Query Processing'
 * });
 *
 * @example
 * // Adding feedback and ending session
 * session.feedback({
 *   score: 5,
 *   comment: 'Very helpful and quick response'
 * });
 *
 * session.addTag('resolution', 'solved');
 * session.end();
 */
export class Session extends EvaluatableBaseContainer {
	private static readonly ENTITY = Entity.SESSION;

	/**
	 * Creates a new session log entry.
	 *
	 * @param config - Configuration object defining the session
	 * @param writer - Log writer instance for persisting session data
	 * @example
	 * const session = logger.session({
	 *   id: 'support-session-789',
	 *   name: 'Technical Support Call',
	 * });
	 */
	constructor(config: SessionConfig, writer: LogWriter) {
		super(Session.ENTITY, config, writer);
		this.commit("create");
	}

	/**
	 * Adds feedback to this session from users.
	 *
	 * @param feedback - Feedback object containing score and optional comment
	 * @param feedback.score - Numerical score for the session (1-5)
	 * @param feedback.comment - Optional textual feedback or comments
	 * @returns void
	 * @example
	 * session.feedback({
	 *   score: 4,
	 *   comment: 'Good service but response time could be improved'
	 * });
	 *
	 * @example
	 * // Score only
	 * session.feedback({ score: 5 });
	 */
	public feedback(feedback: { score: number; comment?: string }) {
		this.commit("add-feedback", feedback);
	}

	/**
	 * Static method to add feedback to any session by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The session ID
	 * @param feedback - Feedback object containing score and optional comment
	 * @param feedback.score - Numerical score for the session
	 * @param feedback.comment - Optional textual feedback
	 * @returns void
	 */
	public static feedback_(writer: LogWriter, id: string, feedback: { score: number; comment?: string }) {
		EvaluatableBaseContainer.commit_(writer, Session.ENTITY, id, "add-feedback", feedback);
	}

	/**
	 * Creates a new trace within this session.
	 *
	 * @param config - Configuration for the new trace
	 * @returns A new trace instance associated with this session
	 * @example
	 * const trace = session.trace({
	 *   id: 'authentication-trace',
	 *   name: 'User Authentication Flow',
	 * });
	 */
	public trace(config: TraceConfig): Trace {
		return new Trace(
			{
				...config,
				sessionId: this.id,
			},
			this.writer,
		);
	}

	/**
	 * Static method to create a trace associated with any session by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The session ID
	 * @param config - Configuration for the new trace
	 * @returns A new trace instance
	 */
	public static trace_(writer: LogWriter, id: string, config: TraceConfig) {
		config.sessionId = id;
		return new Trace(config, writer);
	}
}
