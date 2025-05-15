import { LogWriter } from "../writer";
import { EvaluatableBaseContainer } from "./base";
import { Trace, TraceConfig } from "./trace";
import { Entity } from "./types";

export type SessionConfig = {
	id: string;
	name?: string;
	tags?: Record<string, string>;
};

export class Session extends EvaluatableBaseContainer {
	private static readonly ENTITY = Entity.SESSION;

	constructor(config: SessionConfig, writer: LogWriter) {
		super(Session.ENTITY, config, writer);
		this.commit("create");
	}

	public feedback(feedback: { score: number; comment?: string }) {
		this.commit("add-feedback", feedback);
	}

	public static feedback_(writer: LogWriter, id: string, feedback: { score: number; comment?: string }) {
		EvaluatableBaseContainer.commit_(writer, Session.ENTITY, id, "add-feedback", feedback);
	}

	public trace(config: TraceConfig): Trace {
		return new Trace(
			{
				...config,
				sessionId: this.id,
			},
			this.writer,
		);
	}

	public static trace_(writer: LogWriter, id: string, config: TraceConfig) {
		config.sessionId = id;
		return new Trace(config, writer);
	}

	public static override end_(writer: LogWriter, id: string, data?: any) {
		EvaluatableBaseContainer.end_(writer, Session.ENTITY, id, data);
	}

	public static override addTag_(writer: LogWriter, id: string, key: string, value: string) {
		EvaluatableBaseContainer.addTag_(writer, Session.ENTITY, id, key, value);
	}
}
