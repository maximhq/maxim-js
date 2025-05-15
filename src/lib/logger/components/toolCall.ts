import { utcNow } from "../utils";
import { LogWriter } from "../writer";
import { BaseContainer } from "./base";
import { Entity } from "./types";

export interface ToolCallConfig {
	id: string;
	name: string;
	description: string;
	args: string;
	tags?: Record<string, string>;
}

export interface ToolCallError {
	message: string;
	code?: string;
	type?: string;
}

export class ToolCall extends BaseContainer {
	private readonly args: string;
	private readonly description: string;

	constructor(config: ToolCallConfig, writer: LogWriter) {
		super(Entity.TOOL_CALL, config, writer);
		this.args = config.args;
		this.description = config.description;
	}

	public update(data: Record<string, any>): void {
		this.commit("update", data);
	}

	public static update_(writer: LogWriter, id: string, data: Record<string, any>): void {
		BaseContainer.commit_(writer, Entity.TOOL_CALL, id, "update", data);
	}

	public result(result: string): void {
		this.commit("result", { result });
		this.end();
	}

	public static result_(writer: LogWriter, id: string, result: string): void {
		BaseContainer.commit_(writer, Entity.TOOL_CALL, id, "result", { result });
		BaseContainer.end_(writer, Entity.TOOL_CALL, id, {
			endTimestamp: utcNow(),
		});
	}

	public error(error: ToolCallError): void {
		this.commit("error", { error });
		this.end();
	}

	public static error_(writer: LogWriter, id: string, error: ToolCallError): void {
		BaseContainer.commit_(writer, Entity.TOOL_CALL, id, "error", { error });
		BaseContainer.end_(writer, Entity.TOOL_CALL, id, {
			endTimestamp: utcNow(),
		});
	}

	public override data(): Record<string, any> {
		const baseData = super.data();
		return {
			...baseData,
			name: this._name,
			description: this.description,
			args: this.args,
		};
	}
}
