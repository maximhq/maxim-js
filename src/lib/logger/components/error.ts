import { LogWriter } from "../writer";
import { BaseContainer } from "./base";
import { Entity } from "./types";

export type ErrorConfig = {
	id: string;
	message: string;
	code?: string;
	name?: string;
	type?: string;
	tags?: Record<string, string>;
	metadata?: Record<string, any>;
};

export class Error extends BaseContainer {
	protected message: string;
	protected code?: string;
	protected errorType?: string;
	protected name?: string;

	constructor(config: ErrorConfig, writer: LogWriter) {
		super(Entity.ERROR, config, writer);
		this.message = config.message;
		this.code = config.code;
		this.errorType = config.type;
		this.name = config.name;
	}

	public override data() {
		return {
			...super.data(),
			message: this.message,
			code: this.code,
			errorType: this.errorType,
			name: this.name,
		};
	}
}
