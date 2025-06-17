/**
 * Enumeration of all entity types supported by the Maxim logging system.
 *
 * These entities represent different types of components
 * that can be logged and tracked within the Maxim observability platform.
 *
 * @enum {string}
 * @readonly
 * @example
 * // Entity types are used internally by container classes
 * const session = new Session(config, writer); // Uses Entity.SESSION
 * const trace = new Trace(config, writer); // Uses Entity.TRACE
 */
export enum Entity {
	/** User or system session containing multiple traces */
	SESSION = "session",
	/** Individual execution trace containing spans and operations */
	TRACE = "trace",
	/** Hierarchical span within a trace for grouping operations */
	SPAN = "span",
	/** LLM generation or completion operation */
	GENERATION = "generation",
	/** User or system feedback on operations */
	FEEDBACK = "feedback",
	/** Document or information retrieval operation */
	RETRIEVAL = "retrieval",
	/** Function or tool call execution */
	TOOL_CALL = "tool_call",
	/** Error or exception occurrence */
	ERROR = "error",
}

/**
 * Represents a log action within the Maxim system.
 *
 * CommitLog instances are used to record all changes to components,
 * they are used by the log writer to persist data to the backend.
 *
 * @class CommitLog
 */
export class CommitLog {
	protected entity: Entity;
	protected entityId: string;
	public readonly action: string;
	public readonly data: Record<string, any>;

	/**
	 * Creates a new commit log entry.
	 *
	 * @param entity - The type of entity being logged
	 * @param entityId - Unique identifier for the entity instance
	 * @param action - The action being performed (e.g., 'create', 'update', 'end')
	 * @param data - Data associated with the action
	 */
	constructor(entity: Entity, entityId: string, action: string, data: Record<string, any>) {
		this.entity = entity;
		this.entityId = entityId;
		this.action = action;
		this.data = data;
	}

	/**
	 * Gets the unique identifier for the entity associated with this log entry.
	 *
	 * @returns The entity's unique ID
	 */
	public get id(): string {
		return this.entityId;
	}

	/**
	 * Gets the entity type for this log entry.
	 *
	 * @returns The entity type enum value
	 */
	public get type(): Entity {
		return this.entity;
	}

	/**
	 * Serializes the commit log to a formatted string representation for logging.
	 *
	 * @returns A string representation of the log entry with entity, ID, action, and data
	 */
	public serialize(): string {
		return `${this.entity}{id=${this.entityId},action=${this.action},data=${JSON.stringify(this.data)}}`;
	}
}
