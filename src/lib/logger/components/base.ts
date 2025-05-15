import { makeObjectSerializable, uniqueId, utcNow } from "../utils";
import { LogWriter } from "../writer";
import { CommitLog, Entity } from "./types";

export interface ContainerLister {
	onEnd: () => void;
}

export type BaseConfig = {
	id: string;
	spanId?: string;
	name?: string;
	tags?: Record<string, string>;
};

export abstract class BaseContainer {
	protected readonly entity: Entity;
	protected _id: string;
	protected _name?: string;
	protected spanId?: string;
	protected readonly startTimestamp: Date;
	protected endTimestamp?: Date;
	protected tags: Record<string, string>;
	protected readonly writer: LogWriter;

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
			}
		}
		this._id = config.id;
		this._name = config.name;
		this.spanId = config.spanId;
		this.startTimestamp = utcNow();
		this.tags = config.tags || {};
		this.writer = writer;
	}

	public get id(): string {
		return this._id;
	}

	public addTag(key: string, value: string) {
		this.commit("update", { tags: { [key]: value } });
	}

	public static addTag_(writer: LogWriter, entity: Entity, id: string, key: string, value: string) {
		BaseContainer.commit_(writer, entity, id, "update", { tags: { [key]: value } });
	}

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

	public end() {
		this.endTimestamp = utcNow();
		this.commit("end", { endTimestamp: this.endTimestamp });
	}

	public static end_(writer: LogWriter, entity: Entity, id: string, data?: any) {
		if (!data) {
			data = { endTimestamp: utcNow() };
		} else if (!data.endTimestamp) {
			data.endTimestamp = utcNow();
		}
		BaseContainer.commit_(writer, entity, id, "end", data);
	}

	public data(): any {
		return {
			name: this._name,
			spanId: this.spanId,
			tags: this.tags,
			startTimestamp: this.startTimestamp,
			endTimestamp: this.endTimestamp,
		};
	}

	protected commit(action: string, data?: any) {
		this.writer.commit(new CommitLog(this.entity, this._id, action, data ? data : this.data()));
	}

	protected static commit_(writer: LogWriter, entity: Entity, id: string, action: string, data?: any) {
		writer.commit(new CommitLog(entity, id, action, data ?? {}));
	}
}

export abstract class EvaluatableBaseContainer extends BaseContainer {
	/**
	 * Evaluate the current node
	 */
	public get evaluate() {
		return new EvaluateContainer(this.writer, this.entity, this.id);
	}

	public static evaluate_(writer: LogWriter, entity: Entity, id: string) {
		return new EvaluateContainer(writer, entity, id);
	}
}

export abstract class EventEmittingBaseContainer extends EvaluatableBaseContainer {
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

export class EvaluateContainer {
	private _writer: LogWriter;
	private _entity: Entity;
	private _id: string;

	constructor(writer: LogWriter, entity: Entity, id: string) {
		this._writer = writer;
		this._entity = entity;
		this._id = id;
	}

	/**
	 * Provide variables to evaluate the current node with
	 * @param variables key-value pairs of variables for the evaluators
	 * @param forEvaluators list of evaluators to attach the variables to
	 * @example
	 * generation.evaluate.withVariables(
	 *     {
	 *         output: assistantResponse.choices[0].message.content,
	 *         input: userInput,
	 *     },
	 *     ["bias"]
	 * )
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
	 * Attach evaluators to the current node
	 * @param evaluators list of evaluators to attach
	 * @returns function to attach variables to the evaluators
	 * @see {@link withVariables}
	 * @example
	 * generation.evaluate
	 *     .withEvaluators("bias", "clarity")
	 *     // returns function to attach variables
	 *     // to the evaluators via chaining
	 *     .withVariables({
	 *         output: assistantResponse.choices[0].message.content,
	 *         input: userInput,
	 *     })
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
