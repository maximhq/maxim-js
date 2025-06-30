import { v4 as uuid } from "uuid";
import { makeObjectSerializable, uniqueId, utcNow } from "../utils";
import { LogWriter } from "../writer";
import { CommitLog, Entity } from "./types";

/**
 * Configuration object for base container initialization.
 */
export type BaseConfig = {
	id: string;
	spanId?: string;
	name?: string;
	tags?: Record<string, string>;
};

/**
 * Abstract base class for all logging containers in the Maxim SDK.
 *
 * Provides common functionality for managing container lifecycle, metadata, tags,
 * and communication with the log writer. All specific container types extend this class.
 *
 * @abstract
 * @class BaseContainer
 * @example
 * // BaseContainer is not instantiated directly, but through subclasses
 * const session = new Session({ id: 'session-1', name: 'User Chat' }, writer);
 * session.addTag('user_id', '12345');
 * session.addMetadata({ context: 'support_chat' });
 */
export abstract class BaseContainer {
	protected readonly entity: Entity;
	protected _id: string;
	protected _name?: string;
	protected spanId?: string;
	protected readonly startTimestamp: Date;
	protected endTimestamp?: Date;
	protected tags: Record<string, string>;
	protected readonly writer: LogWriter;

	/**
	 * Creates a new base container instance.
	 *
	 * @param entity - The entity type this container represents
	 * @param config - Configuration for the container
	 * @param writer - Log writer instance for committing changes
	 * @throws {Error} When the provided ID contains invalid characters (only alphanumeric, hyphens, and underscores allowed; only throws if you have `raiseExceptions` config set to true)
	 */
	constructor(entity: Entity, config: BaseConfig, writer: LogWriter) {
		this.entity = entity;
		if (!config.id) {
			config.id = uniqueId();
		}
		// Validate ID format - only allow alphanumeric characters, hyphens, and underscores
		if (!/^[a-zA-Z0-9_-]+$/.test(config.id)) {
			if (writer.raiseExceptions) {
				throw new Error(
					`Invalid ID: ${config.id}. ID must only contain alphanumeric characters, hyphens, and underscores. Event will not be logged.`,
				);
			} else {
				console.error(
					`Invalid ID: ${config.id}. ID must only contain alphanumeric characters, hyphens, and underscores. Event will not be logged.`,
				);
				this._id = uuid();
			}
		} else {
			this._id = config.id;
		}
		this._name = config.name;
		this.spanId = config.spanId;
		this.startTimestamp = utcNow();
		this.tags = config.tags || {};
		this.writer = writer;
	}

	/**
	 * Gets the unique identifier for this container.
	 *
	 * @returns The container's unique ID
	 */
	public get id(): string {
		return this._id;
	}

	/**
	 * Adds a tag to this container for categorization and filtering.
	 *
	 * @param key - The tag key
	 * @param value - The tag value
	 * @returns void
	 * @example
	 * container.addTag('environment', 'production');
	 * container.addTag('user_type', 'premium');
	 */
	public addTag(key: string, value: string) {
		this.commit("update", { tags: { [key]: value } });
	}

	/**
	 * Static method to add a tag to any container by ID.
	 *
	 * @param writer - The log writer instance
	 * @param entity - The entity type
	 * @param id - The container ID
	 * @param key - The tag key
	 * @param value - The tag value
	 * @returns void
	 */
	public static addTag_(writer: LogWriter, entity: Entity, id: string, key: string, value: string) {
		BaseContainer.commit_(writer, entity, id, "update", { tags: { [key]: value } });
	}

	/**
	 * Adds metadata to this container for additional context and debugging. Any data type could be added as the value in the metadata record.
	 *
	 * @param metadata - Key-value pairs of metadata
	 * @returns void
	 * @example
	 * container.addMetadata({
	 *   requestId: 'req-123',
	 *   userAgent: 'Mozilla/5.0...',
	 *   processingTime: 1500
	 * });
	 */
	public addMetadata(metadata: Record<string, unknown>) {
		const sanitizedMetadata = Object.entries(metadata).reduce(
			(acc, [key, value]) => {
				acc[key] = JSON.stringify(makeObjectSerializable(value));
				return acc;
			},
			{} as Record<string, string>,
		);
		this.commit("update", { metadata: sanitizedMetadata });
	}

	/**
	 * Static method to add metadata to any container by ID.
	 *
	 * @param writer - The log writer instance
	 * @param entity - The entity type
	 * @param id - The container ID
	 * @param metadata - The metadata to add
	 * @returns void
	 */
	public static addMetadata_(writer: LogWriter, entity: Entity, id: string, metadata: Record<string, unknown>) {
		const sanitizedMetadata = Object.entries(metadata).reduce(
			(acc, [key, value]) => {
				acc[key] = JSON.stringify(makeObjectSerializable(value));
				return acc;
			},
			{} as Record<string, string>,
		);
		BaseContainer.commit_(writer, entity, id, "update", { metadata: sanitizedMetadata });
	}

	/**
	 * Marks this container as ended and records the end timestamp.
	 *
	 * @returns void
	 * @example
	 * // End a container when processing is complete
	 * container.end();
	 */
	public end() {
		this.endTimestamp = utcNow();
		this.commit("end", { endTimestamp: this.endTimestamp });
	}

	/**
	 * Static method to end any container by ID.
	 *
	 * @param writer - The log writer instance
	 * @param entity - The entity type
	 * @param id - The container ID
	 * @param data - Optional additional data to include with the end event
	 * @returns void
	 */
	public static end_(writer: LogWriter, entity: Entity, id: string, data?: any) {
		if (!data) {
			data = { endTimestamp: utcNow() };
		} else if (!data.endTimestamp) {
			data.endTimestamp = utcNow();
		}
		BaseContainer.commit_(writer, entity, id, "end", data);
	}

	/**
	 * Returns the current data state of this container.
	 *
	 * @returns The container's data.
	 */
	public data(): any {
		return {
			name: this._name,
			spanId: this.spanId,
			tags: this.tags,
			startTimestamp: this.startTimestamp,
			endTimestamp: this.endTimestamp,
		};
	}

	/**
	 * Commits a change to this container via the log writer.
	 *
	 * @protected
	 * @param action - The action being performed
	 * @param data - Data associated with the action
	 * @returns void
	 */
	protected commit(action: string, data?: any) {
		this.writer.commit(new CommitLog(this.entity, this._id, action, data ? data : this.data()));
	}

	/**
	 * Static method to commit changes to any container by ID.
	 *
	 * @protected
	 * @param writer - The log writer instance
	 * @param entity - The entity type
	 * @param id - The container ID
	 * @param action - The action being performed
	 * @param data - Data associated with the action
	 * @returns void
	 */
	protected static commit_(writer: LogWriter, entity: Entity, id: string, action: string, data?: any) {
		writer.commit(new CommitLog(entity, id, action, data ?? {}));
	}
}

/**
 * Extended base container that supports evaluation functionality.
 *
 * Provides additional capabilities for containers that can be evaluated,
 * such as sessions, traces, generations, and retrievals. Includes methods
 * for triggering evaluations.
 *
 * @abstract
 * @class EvaluatableBaseContainer
 * @extends BaseContainer
 */
export abstract class EvaluatableBaseContainer extends BaseContainer {
	/**
	 * Gets the evaluation methods for this container.
	 *
	 * @returns Evaluation methods for configuring and triggering evaluations
	 * @example
	 * container.evaluate.withEvaluators('bias', 'toxicity');
	 */
	public get evaluate() {
		return new EvaluateContainer(this.writer, this.entity, this.id);
	}

	/**
	 * Static method to get evaluation methods for any evaluatable container by ID.
	 *
	 * @param writer - The log writer instance
	 * @param entity - The entity type
	 * @param id - The container ID
	 * @returns Evaluation methods for configuring and triggering evaluations
	 */
	public static evaluate_(writer: LogWriter, entity: Entity, id: string) {
		return new EvaluateContainer(writer, entity, id);
	}
}

/**
 * Extended evaluatable container that supports event emission.
 *
 * Provides capabilities for containers that can emit events. Used by traces and spans.
 *
 * @abstract
 * @class EventEmittingBaseContainer
 * @extends EvaluatableBaseContainer
 */
export abstract class EventEmittingBaseContainer extends EvaluatableBaseContainer {
	/**
	 * Emits a custom event within this container.
	 *
	 * @param id - Unique identifier for the event
	 * @param name - Human-readable name for the event
	 * @param tags - Optional tags for categorizing the event
	 * @param metadata - Optional metadata for additional context
	 * @returns void
	 * @example
	 * container.event(
	 *   'checkpoint-1',
	 *   'Processing Milestone',
	 *   { phase: 'preprocessing', status: 'complete' },
	 *   { itemsProcessed: 1000, timeElapsed: 5.2 }
	 * );
	 */
	public event(id: string, name: string, tags?: Record<string, string>, metadata?: Record<string, unknown>) {
		if (metadata) {
			const sanitizedMetadata = Object.entries(metadata).reduce(
				(acc, [key, value]) => {
					acc[key] = JSON.stringify(makeObjectSerializable(value));
					return acc;
				},
				{} as Record<string, string>,
			);
			this.commit("add-event", { id: id, name, timestamp: utcNow(), tags, metadata: sanitizedMetadata });
			return;
		}
		this.commit("add-event", { id: id, name, timestamp: utcNow(), tags });
	}

	/**
	 * Static method to emit an event for any event-emitting container by ID.
	 *
	 * @param writer - The log writer instance
	 * @param entity - The entity type
	 * @param id - The container ID
	 * @param eventId - Unique identifier for the event
	 * @param name - Human-readable name for the event
	 * @param tags - Optional tags for categorizing the event
	 * @param metadata - Optional metadata for additional context
	 * @returns void
	 */
	public static event_(
		writer: LogWriter,
		entity: Entity,
		id: string,
		eventId: string,
		name: string,
		tags?: Record<string, string>,
		metadata?: Record<string, unknown>,
	) {
		if (metadata) {
			const sanitizedMetadata = Object.entries(metadata).reduce(
				(acc, [key, value]) => {
					acc[key] = JSON.stringify(makeObjectSerializable(value));
					return acc;
				},
				{} as Record<string, string>,
			);
			BaseContainer.commit_(writer, entity, id, "add-event", { id: eventId, name, timestamp: utcNow(), tags, metadata: sanitizedMetadata });
			return;
		}
		BaseContainer.commit_(writer, entity, id, "add-event", { id: eventId, name, timestamp: utcNow(), tags });
	}
}

/**
 * Container for configuring and triggering evaluations on containers.
 *
 * Provides an interface for setting up evaluations with variables.
 * Used to assess the quality and performance of different operations
 * for your application.
 *
 * @class EvaluateContainer
 * @example
 // Attaching evaluators to a container
 * container.evaluate
 *   .withEvaluators('bias', 'toxicity')
 *    // Optionally, directly chain variables for the evaluators mentioned above
 *   .withVariables({ context: 'user_query', expected: 'gold_standard' });
 *
 * @example
 * // Attaching variables at a later stage to specific evaluators
 * container.evaluate
 *   .withVariables({ context: 'user_query', expected: 'gold_standard' }, ['bias']);
 */
export class EvaluateContainer {
	private _writer: LogWriter;
	private _entity: Entity;
	private _id: string;

	/**
	 * Creates a new evaluation container instance.
	 *
	 * @param writer - The log writer instance for committing evaluations
	 * @param entity - The entity type being evaluated
	 * @param id - The unique identifier of the entity being evaluated
	 * @example
	 * // Usually created through container.evaluate getter
	 * const evaluator = new EvaluateContainer(writer, Entity.GENERATION, 'gen-123');
	 */
	constructor(writer: LogWriter, entity: Entity, id: string) {
		this._writer = writer;
		this._entity = entity;
		this._id = id;
	}

	/**
	 * Configures variables for specific evaluators in the evaluation.
	 *
	 * Variables provide the values needed by the evaluators to
	 * execute; such as expected outputs, retrieved contexts, or input queries.
	 *
	 * @template T - String literal type for variable names
	 * @param variables - Key-value pairs mapping variables to their values
	 * @param forEvaluators - Array of evaluator names that should receive these variables
	 * @example
	 * // Provide expected output for `accuracy` evaluator
	 * container.evaluate
	 *   .withVariables(
	 *     { expected_output: 'The correct answer is 42' },
	 *     ['bias']
	 *   )
	 *
	 * @example
	 * // Multiple variables for different evaluators
	 * container.evaluate
	 *   .withVariables(
	 *     { context: 'Retrieved documents...', user_query: 'What is AI?' },
	 *     ['bias', 'toxicity']
	 *   );
	 */
	public withVariables<T extends string = string>(variables: Record<T, string>, forEvaluators: string[]) {
		if (forEvaluators.length === 0) return;
		this._writer.commit(
			new CommitLog(this._entity, this._id, "evaluate", {
				with: "variables",
				variables,
				evaluators: Array.from(new Set(forEvaluators)),
				timestamp: utcNow(),
			}),
		);
	}

	/**
	 * Specifies which evaluators should be attached for evaluation to this container.
	 *
	 * @template T - String literal type for evaluator names
	 * @param evaluators - Names of evaluators to be used for evaluation once all variables are available to them
	 * @example
	 * // Use built-in evaluators
	 * container.evaluate
	 *   .withEvaluators('bias', 'toxicity');
	 *
	 * @example
	 * // Mix of built-in and custom evaluators
	 * container.evaluate
	 *   .withEvaluators(
	 *     'bias',
	 *     'custom_domain_knowledge',
	 *     'brand_compliance'
	 *   );
	 */
	public withEvaluators<T extends string = string>(...evaluators: string[]) {
		if (evaluators.length === 0) {
			return {
				withVariables: <U extends string = T>(variables: Record<U, string>) => {
					this.withVariables<U>(variables, evaluators);
				},
			};
		}

		const uniqueEvaluators = Array.from(new Set(evaluators));

		this._writer.commit(
			new CommitLog(this._entity, this._id, "evaluate", {
				with: "evaluators",
				evaluators: uniqueEvaluators,
				timestamp: utcNow(),
			}),
		);

		return {
			withVariables: <U extends string = T>(variables: Record<U, string>) => {
				this.withVariables<U>(variables, uniqueEvaluators);
			},
		};
	}
}
