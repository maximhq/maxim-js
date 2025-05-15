export enum Entity {
	SESSION = "session",
	TRACE = "trace",
	SPAN = "span",
	GENERATION = "generation",
	FEEDBACK = "feedback",
	RETRIEVAL = "retrieval",
	TOOL_CALL = "tool_call",
	ERROR = "error",
}

export class CommitLog {
	protected entity: Entity;
	protected entityId: string;
	public readonly action: string;
	public readonly data: Record<string, any>;

	constructor(entity: Entity, entityId: string, action: string, data: Record<string, any>) {
		this.entity = entity;
		this.entityId = entityId;
		this.action = action;
		this.data = data;
	}

	public get id(): string {
		return this.entityId;
	}

	public get type(): Entity {
		return this.entity;
	}

	public serialize(): string {
		return `${this.entity}{id=${this.entityId},action=${this.action},data=${JSON.stringify(this.data)}}`;
	}
}
