import { uniqueId, utcNow } from "../utils";
import { LogWriter } from "../writer";
import { Attachment } from "./attachment";
import { EvaluatableBaseContainer } from "./base";
import { Entity } from "./types";

export interface GenerationError {
	message: string;
	code?: string;
	type?: string;
}

export interface ChatCompletionResult {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<ChatCompletionChoice>;
	usage: Usage;
	error?: GenerationError;
}

export interface TextCompletionResult {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<TextCompletionChoice>;
	usage: Usage;
	error?: GenerationError;
}

interface ToolCallFunction {
	arguments: string;
	name: string;
}

interface ToolCall {
	id: string;
	function: ToolCallFunction;
	type: string;
}

interface ChatCompletionMessage {
	role: "assistant";
	content: string | null;
	function_call?: ToolCallFunction;
	tool_calls?: Array<ToolCall>;
}

interface Logprobs {
	text_offset?: Array<number>;
	token_logprobs?: Array<number>;
	tokens?: Array<string>;
	top_logprobs?: Array<Record<string, number>>;
}

interface ChatCompletionChoice {
	index: number;
	message: ChatCompletionMessage;
	logprobs: Logprobs | null;
	finish_reason: string;
}

interface TextCompletionChoice {
	index: number;
	text: string;
	logprobs: Logprobs | null;
	finish_reason: string;
}

interface Usage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export type CompletionRequestTextContent = {
	type: "text";
	text: string;
};

export type CompletionRequestImageUrlContent = {
	type: "image_url";
	image_url: {
		url: string;
		detail?: string;
	};
};

type CompletionRequestContent = CompletionRequestTextContent | CompletionRequestImageUrlContent;

export interface CompletionRequest {
	role: "user" | "assistant" | "system";
	content: string | Array<CompletionRequestContent>;
}

export type GenerationConfig = {
	id: string;
	name?: string;
	provider: "openai" | "bedrock" | "anthropic" | "huggingface" | "azure" | "together" | "groq" | "google";
	model: string;
	maximPromptId?: string;
	messages: CompletionRequest[];
	modelParameters: Record<string, any>;
	tags?: Record<string, string>;
};

export class Generation extends EvaluatableBaseContainer {
	private model?: string;
	private provider?: string;
	private maximPromptId?: string;
	private modelParameters?: Record<string, any>;

	constructor(config: GenerationConfig, writer: LogWriter) {
		super(Entity.GENERATION, config, writer);
		this.model = config.model;
		this.provider = config.provider;
		this.maximPromptId = config.maximPromptId;
		this.modelParameters = config.modelParameters;
	}

	public setModel(model: string) {
		this.model = model;
		this.commit("update", { model });
	}

	public static setModel_(writer: LogWriter, id: string, model: string) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "update", { model });
	}

	public addMessages(messages: CompletionRequest[]) {
		this.commit("update", { messages: messages });
	}

	public static addMessages_(writer: LogWriter, id: string, messages: CompletionRequest[]) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "update", { messages });
	}

	public setModelParameters(modelParameters: Record<string, any>) {
		this.commit("update", { modelParameters });
	}

	public static setModelParameters_(writer: LogWriter, id: string, modelParameters: Record<string, any>) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "update", { modelParameters });
	}

	public result(result: TextCompletionResult | ChatCompletionResult) {
		this.commit("result", { result });
		this.end();
	}

	public static result_(writer: LogWriter, id: string, result: TextCompletionResult | ChatCompletionResult) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "result", { result });
		EvaluatableBaseContainer.end_(writer, Entity.GENERATION, id, { endTimestamp: utcNow() });
	}

	public error(error: GenerationError) {
		this.commit("result", { result: { error: error, id: uniqueId() } });
		this.end();
	}

	public static error_(writer: LogWriter, id: string, error: GenerationError) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "result", { result: { error: error, id: uniqueId() } });
		EvaluatableBaseContainer.end_(writer, Entity.GENERATION, id, { endTimestamp: utcNow() });
	}

	public addAttachment(attachment: Attachment) {
		this.commit("upload-attachment", attachment);
	}

	public static addAttachment_(writer: LogWriter, id: string, attachment: Attachment) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, "upload-attachment", attachment);
	}

	public static override end_(writer: LogWriter, id: string, data?: any) {
		EvaluatableBaseContainer.end_(writer, Entity.GENERATION, id, data);
	}

	public static add_tag_(writer: LogWriter, id: string, event: string, data?: any) {
		EvaluatableBaseContainer.commit_(writer, Entity.GENERATION, id, event, data);
	}

	public override data(): any {
		return {
			...super.data(),
			provider: this.provider,
			model: this.model,
			maximPromptId: this.maximPromptId,
			modelParameters: this.modelParameters,
		};
	}
}
