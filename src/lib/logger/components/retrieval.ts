import { utcNow } from "../utils";
import { LogWriter } from "../writer";
import { EvaluatableBaseContainer } from "./base";
import { Entity } from "./types";

export type RetrievalConfig = {
	id: string;
	name?: string;
	tags?: Record<string, string>;
};

export class Retrieval extends EvaluatableBaseContainer {
	constructor(config: RetrievalConfig, writer: LogWriter) {
		super(Entity.RETRIEVAL, config, writer);
	}

	public input(query: string) {
		this.commit("update", { input: query });
	}

	public static input_(writer: LogWriter, id: string, query: string) {
		EvaluatableBaseContainer.commit_(writer, Entity.RETRIEVAL, id, "update", { input: query });
	}

	public output(docs: string | string[]) {
		let finalDocs = docs;
		if (typeof docs === "string") {
			finalDocs = [docs];
		}
		this.commit("end", { docs: finalDocs, endTimestamp: utcNow() });
	}

	public static output_(writer: LogWriter, id: string, docs: string | string[]) {
		let finalDocs = docs;
		if (typeof docs === "string") {
			finalDocs = [docs];
		}
		EvaluatableBaseContainer.commit_(writer, Entity.RETRIEVAL, id, "end", { docs: finalDocs, endTimestamp: utcNow() });
	}

	public static override end_(writer: LogWriter, id: string, data?: any) {
		EvaluatableBaseContainer.end_(writer, Entity.RETRIEVAL, id, data);
	}

	public static override addTag_(writer: LogWriter, id: string, key: string, value: string) {
		EvaluatableBaseContainer.addTag_(writer, Entity.RETRIEVAL, id, key, value);
	}
}
