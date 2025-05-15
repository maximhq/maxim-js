import { LogWriter } from "../writer";
import { Attachment } from "./attachment";
import { EventEmittingBaseContainer } from "./base";
import { Error, ErrorConfig } from "./error";
import { Generation, GenerationConfig } from "./generation";
import { Retrieval, RetrievalConfig } from "./retrieval";
import { ToolCall, ToolCallConfig } from "./toolCall";
import { Entity } from "./types";

export type SpanConfig = {
	id: string;
	name?: string;
	tags?: Record<string, string>;
};

export class Span extends EventEmittingBaseContainer {
	constructor(config: SpanConfig, writer: LogWriter) {
		super(Entity.SPAN, config, writer);
		this.commit("create");
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
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "add-generation", {
			id: config.id,
			messages: JSON.parse(JSON.stringify(config.messages)),
			...generation.data(),
		});
		return generation;
	}

	public span(config: SpanConfig): Span {
		const span = new Span(config, this.writer);
		this.commit("add-span", {
			id: config.id,
			...span.data(),
		});
		return span;
	}

	public static span_(writer: LogWriter, id: string, config: SpanConfig) {
		const span = new Span(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "add-span", {
			id: config.id,
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

	public static error_(writer: LogWriter, id: string, config: ErrorConfig): Error {
		const error = new Error(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "add-error", {
			id: config.id,
			...error.data(),
		});
		return error;
	}

	public retrieval(config: RetrievalConfig): Retrieval {
		const retrieval = new Retrieval(config, this.writer);
		this.commit("add-retrieval", {
			id: config.id,
			...retrieval.data(),
		});
		return retrieval;
	}

	public static retrieval_(writer: LogWriter, id: string, config: RetrievalConfig) {
		const retrieval = new Retrieval(config, writer);
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "add-retrieval", {
			id: config.id,
			...retrieval.data(),
		});
		return retrieval;
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
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "add-tool-call", {
			id: config.id,
			...toolCall.data(),
		});
		return toolCall;
	}

	public addAttachment(attachment: Attachment) {
		this.commit("upload-attachment", attachment);
	}

	public static addAttachment_(writer: LogWriter, id: string, attachment: Attachment) {
		EventEmittingBaseContainer.commit_(writer, Entity.SPAN, id, "upload-attachment", attachment);
	}

	public static override end_(writer: LogWriter, id: string, data?: any) {
		EventEmittingBaseContainer.end_(writer, Entity.SPAN, id, data);
	}

	public static override addTag_(writer: LogWriter, id: string, key: string, value: string) {
		EventEmittingBaseContainer.addTag_(writer, Entity.SPAN, id, key, value);
	}
}
