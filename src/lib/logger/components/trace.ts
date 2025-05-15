import { LogWriter } from "../writer";
import { Attachment } from "./attachment";
import { EventEmittingBaseContainer } from "./base";
import { Error, ErrorConfig } from "./error";
import { Generation, GenerationConfig } from "./generation";
import { Retrieval, RetrievalConfig } from "./retrieval";
import { Span, SpanConfig } from "./span";
import { ToolCall, ToolCallConfig } from "./toolCall";
import { Entity } from "./types";

export type TraceConfig = {
	id: string;
	name?: string;
	sessionId?: string;
	tags?: Record<string, string>;
};

export class Trace extends EventEmittingBaseContainer {
	constructor(config: TraceConfig, writer: LogWriter) {
		super(Entity.TRACE, config, writer);
		this.commit("create", {
			...this.data(),
			sessionId: config.sessionId,
		});
	}

	public generation(config: GenerationConfig): Generation {
		const generation = new Generation(config, this.writer);
		this.commit("add-generation", {
			id: config.id,
			messages: JSON.parse(JSON.stringify(config.messages)),
			...generation.data(),
		});
		return generation;
	}

	public static generation_(writer: LogWriter, id: string, config: GenerationConfig) {
		const generation = new Generation(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-generation", {
			id: config.id,
			messages: JSON.parse(JSON.stringify(config.messages)),
			...generation.data(),
		});
		return generation;
	}

	public addToSession(sessionId: string) {
		this.commit("update", { sessionId });
	}

	public static addToSession_(writer: LogWriter, id: string, sessionId: string) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "update", { sessionId });
	}

	public feedback(feedback: { score: number; comment?: string }) {
		this.commit("add-feedback", feedback);
	}

	public static feedback_(writer: LogWriter, id: string, feedback: { score: number; comment?: string }) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-feedback", feedback);
	}

	public addAttachment(attachment: Attachment) {
		this.commit("upload-attachment", attachment);
	}

	public static addAttachment_(writer: LogWriter, id: string, attachment: Attachment) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "upload-attachment", attachment);
	}

	public span(config: SpanConfig): Span {
		const span = new Span(config, this.writer);
		this.commit("add-span", {
			id: span.id,
			...span.data(),
		});
		return span;
	}

	public static span_(writer: LogWriter, id: string, config: SpanConfig) {
		const span = new Span(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-span", {
			id: span.id,
			...span.data(),
		});
		return span;
	}

	public error(config: ErrorConfig): Error {
		const error = new Error(config, this.writer);
		this.commit("add-error", {
			id: config.id,
			...error.data(),
		});
		return error;
	}

	public static error_(writer: LogWriter, id: string, config: ErrorConfig) {
		const error = new Error(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-error", {
			id: config.id,
			...error.data(),
		});
		return error;
	}

	public toolCall(config: ToolCallConfig) {
		const toolCall = new ToolCall(config, this.writer);
		this.commit("add-tool-call", {
			id: config.id,
			...toolCall.data(),
		});
		return toolCall;
	}

	public static toolCall_(writer: LogWriter, id: string, config: ToolCallConfig) {
		const toolCall = new ToolCall(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-tool-call", {
			id: toolCall.id,
			...toolCall.data(),
		});
		return toolCall;
	}

	public retrieval(config: RetrievalConfig): Retrieval {
		const retrieval = new Retrieval(config, this.writer);
		this.commit("add-retrieval", {
			id: config.id,
			...retrieval.data(),
		});
		return retrieval;
	}

	public input(input: string): Trace {
		this.commit("update", { input });
		return this;
	}

	public output(output: string): Trace {
		this.commit("update", { output });
		return this;
	}

	public static retrieval_(writer: LogWriter, id: string, config: RetrievalConfig) {
		const retrieval = new Retrieval(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "add-retrieval", {
			id: config.id,
			...retrieval.data(),
		});
		return retrieval;
	}

	public static input_(writer: LogWriter, id: string, input: string) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "update", {
			input: input,
		});
	}

	public static output_(writer: LogWriter, id: string, output: string) {
		EventEmittingBaseContainer.commit_(writer, Entity.TRACE, id, "update", {
			output: output,
		});
	}

	public static override end_(writer: LogWriter, id: string, data?: any) {
		EventEmittingBaseContainer.end_(writer, Entity.TRACE, id, data);
	}

	public static override addTag_(writer: LogWriter, id: string, key: string, value: string) {
		EventEmittingBaseContainer.addTag_(writer, Entity.TRACE, id, key, value);
	}
}
