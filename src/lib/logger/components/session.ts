import { ILogWriter } from "../types";
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
	constructor(config: SessionConfig, writer: ILogWriter) {
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
	public static feedback_(writer: ILogWriter, id: string, feedback: { score: number; comment?: string }) {
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
	public static trace_(writer: ILogWriter, id: string, config: TraceConfig) {
		config.sessionId = id;
		return new Trace(config, writer);
	}

	/**
	 * Adds a numeric metric to this session.
	 *
	 * Records quantitative values such as counts and aggregates across all traces in the
	 * session. Each call adds or updates a single metric entry under the provided name.
	 *
	 * Common examples include: `tool_calls_count`, `traces_count`, `user_messages_count`, `assistant_messages_count`.
	 *
	 * @param name - Name of the metric
	 * @param value - Numeric value of the metric (numeric)
	 * @returns void
	 * @example
	 * session.addMetric('traces_count', 4);
	 * session.addMetric('user_messages_count', 2);
	 */
	public addMetric(name: string, value: number) {
		this.commit("update", { metrics: { [name]: value } });
	}

	/**
	 * Static method to add a metric to any session by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The session ID
	 * @param name - Name of the metric
	 * @param value - Numeric value of the metric (numeric)
	 * @returns void
	 */
	public static addMetric_(writer: ILogWriter, id: string, name: string, value: number) {
		EvaluatableBaseContainer.commit_(writer, Session.ENTITY, id, "update", { metrics: { [name]: value } });
	}
}
