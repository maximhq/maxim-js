import { BaseCallbackHandler, BaseCallbackHandlerInput } from "@langchain/core/callbacks/base";
import { isToolMessage } from "@langchain/core/messages";
import { inspect } from "util";
import { v4 as uuid } from "uuid";
import { GenerationConfig, MaximLogger, RetrievalConfig, SpanConfig, ToolCallConfig } from "../../../../index";
import { Container, ContainerManager, MaximMetadata, Metadata, SpanContainer, TraceContainer } from "../../models/containers";
import {
	addParsedTagsToLogger,
	convertLLMResultToCompletionResult,
	determineProvider,
	parseLangchainErrorToMaximError,
	parseLangchainMessages,
	parseLangchainModelAndParameters,
	parseLangchainTags,
} from "./utils";

type HandleLLMStartParameters = Parameters<NonNullable<BaseCallbackHandler["handleLLMStart"]>>;
type HandleLLMEndParameters = Parameters<NonNullable<BaseCallbackHandler["handleLLMEnd"]>>;
type HandleLLMErrorParameters = Parameters<NonNullable<BaseCallbackHandler["handleLLMError"]>>;
type HandleChatModelStartParameters = Parameters<NonNullable<BaseCallbackHandler["handleChatModelStart"]>>;
type HandleRetrieverStartParameters = Parameters<NonNullable<BaseCallbackHandler["handleRetrieverStart"]>>;
type HandleRetrieverEndParameters = Parameters<NonNullable<BaseCallbackHandler["handleRetrieverEnd"]>>;
type HandleChainStartParameters = Parameters<NonNullable<BaseCallbackHandler["handleChainStart"]>>;
type HandleChainEndParameters = Parameters<NonNullable<BaseCallbackHandler["handleChainEnd"]>>;
type HandleToolStartParameters = Parameters<NonNullable<BaseCallbackHandler["handleToolStart"]>>;
type HandleToolEndParameters = Parameters<NonNullable<BaseCallbackHandler["handleToolEnd"]>>;
type HandleToolErrorParameters = Parameters<NonNullable<BaseCallbackHandler["handleToolError"]>>;
type HandleChainErrorParameters = Parameters<NonNullable<BaseCallbackHandler["handleChainError"]>>;

export class MaximLangchainTracer extends BaseCallbackHandler {
	override readonly name = "MaximLangchainTracer";
	private containerManager: ContainerManager = new ContainerManager();

	constructor(private readonly logger: MaximLogger, input?: BaseCallbackHandlerInput) {
		super(input);
	}

	/**
	 * Safely serializes any value to string, handling circular references and unsupported types like BigInt
	 */
	private safeStringify(value: any): string {
		try {
			return JSON.stringify(value);
		} catch (error) {
			// Fallback to util.inspect for circular references, BigInt, and other unsupported types
			return inspect(value, {
				depth: 3,
				maxArrayLength: 100,
				maxStringLength: 1000,
				breakLength: Infinity,
				compact: true,
			});
		}
	}

	private getMetadataClassFromRecord(metadata?: Record<string, unknown>): MaximMetadata | null {
		if (metadata && "maxim" in metadata) {
			return new Metadata(metadata["maxim"] as Record<string, unknown>);
		}
		return null;
	}

	private getContainer(runId: string, parentRunId?: string): Container | undefined {
		let container: Container | undefined;
		if (parentRunId) {
			container = this.containerManager.getContainer(parentRunId);
		} else {
			// This is the first activity in this run - either get existing or create new trace
			container = this.containerManager.getContainer(runId);
			if (!container) {
				const traceId = uuid();
				container = new TraceContainer(this.containerManager, this.logger, traceId, "Trace", undefined, false);
				container.create();
			}
		}
		return container;
	}

	override handleChainStart(
		_chain: HandleChainStartParameters[0],
		inputs: HandleChainStartParameters[1],
		runId: HandleChainStartParameters[2],
		parentRunId?: HandleChainStartParameters[3],
		tags?: HandleChainStartParameters[4],
		metadata?: HandleChainStartParameters[5],
		_runType?: HandleChainStartParameters[6],
		runName?: HandleChainStartParameters[7],
	): void {
		try {
			// Process metadata
			const maximMetadata = this.getMetadataClassFromRecord(metadata);

			// Get/create container
			const container = this.getContainer(runId, parentRunId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for chain");
				return;
			}

			// Check container creation status
			if (!container.isCreated()) {
				container.create();
			}

			// Process entity-specific logic
			const name = maximMetadata?.chainName ?? runName ?? "default-chain";
			const chainTags: Record<string, string> = parseLangchainTags(maximMetadata?.chainTags, tags);

			// Add run_id and parent_run_id to tags
			chainTags["run_id"] = runId;
			if (parentRunId) {
				chainTags["parent_run_id"] = parentRunId;
			}

			// Add metadata as tags if provided
			if (metadata) {
				Object.entries(metadata).forEach(([key, value]) => {
					chainTags[key.trim()] = typeof value === "string" ? value.trim() : this.safeStringify(value);
				});
			}

			const spanConfig: SpanConfig = {
				id: runId,
				name: name,
				tags: chainTags,
			};

			const span = container.addSpan(spanConfig);

			span.addMetadata({ inputs });

			// Manage container lifecycle
			new SpanContainer(
				this.containerManager,
				this.logger,
				runId,
				name,
				parentRunId,
				container.type === "trace" ? container.id : undefined,
				true,
			);
		} catch (e) {
			console.error("[MaximSDK] Error while processing chain_start", e);
		}
	}

	override handleChainEnd(
		outputs: HandleChainEndParameters[0],
		runId: HandleChainEndParameters[1],
		_parentRunId?: HandleChainEndParameters[2],
		tags?: HandleChainEndParameters[3],
		_kwargs?: HandleChainEndParameters[4],
	): void {
		try {
			// Get/create container (no parentRunId here because we want the runId container to be closed itself)
			const container = this.getContainer(runId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for chain");
				return;
			}

			// Handle tags and outputs
			container.addTags(parseLangchainTags(undefined, tags));
			container.addMetadata({ outputs });

			// Manage container lifecycle
			container.end();
		} catch (e) {
			console.error("[MaximSDK] Failed to parse chain-end:", e);
		}
	}

	override handleChainError(
		err: HandleChainErrorParameters[0],
		runId: HandleChainErrorParameters[1],
		_parentRunId?: HandleChainErrorParameters[2],
		tags?: HandleChainErrorParameters[3],
	): void {
		try {
			// Get/create container (no parentRunId here because we want the runId container to be closed itself)
			const container = this.getContainer(runId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for chain");
				return;
			}

			// Handle tags
			container.addTags(parseLangchainTags(undefined, tags));
			container.addMetadata({ error: err.message });

			// Manage container lifecycle
			container.end();
		} catch (e) {
			console.error("[MaximSDK] Failed to parse chain-error:", e);
		}
	}

	override async handleLLMStart(
		llm: HandleLLMStartParameters[0],
		prompts: HandleLLMStartParameters[1],
		runId: HandleLLMStartParameters[2],
		parentRunId?: HandleLLMStartParameters[3],
		extraParams?: HandleLLMStartParameters[4],
		tags?: HandleLLMStartParameters[5],
		metadata?: HandleLLMStartParameters[6],
		name?: HandleLLMStartParameters[7],
	) {
		try {
			// Process metadata
			const maximMetadata = this.getMetadataClassFromRecord(metadata);

			// Get/create container
			const container = this.getContainer(runId, parentRunId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for LLM");
				return;
			}

			// Check container creation status
			if (!container.isCreated()) {
				container.create();
			}

			// Process entity-specific logic
			const parsedMessages = parseLangchainMessages(prompts);
			const traceContainer = container.getTraceContainer();
			if (traceContainer && traceContainer instanceof TraceContainer) {
				let lastUserInput = "";

				const lastUserMessage = parsedMessages.findLast((m) => m.role === "user");
				if (lastUserMessage) {
					if (typeof lastUserMessage.content === "string") {
						lastUserInput = lastUserMessage.content;
					} else if (Array.isArray(lastUserMessage.content)) {
						const textParts = lastUserMessage.content
							.filter((item) => item.type === "text")
							.map((item) => item.text || "")
							.join(" ");
						if (textParts) {
							lastUserInput = textParts;
						}
					}
				}

				// Set trace input if we found user input
				if (lastUserInput) {
					traceContainer.setInput(lastUserInput);
				}
			}

			const generationName = maximMetadata?.generationName ?? name ?? "default-generation";
			const [model, modelParameters] = parseLangchainModelAndParameters(metadata, extraParams);
			const generationConfig: GenerationConfig = {
				id: runId,
				name: generationName,
				provider: determineProvider(llm.id, metadata),
				model,
				messages: parsedMessages,
				modelParameters,
				tags: parseLangchainTags(maximMetadata?.generationTags, tags),
			};

			container.addGeneration(generationConfig);

			// Manage container lifecycle
			if (!container.parentId) {
				this.containerManager.setContainer(runId, container);
			}
		} catch (e) {
			console.error("[MaximSDK] Error while processing LLM start", e);
		}
	}

	override handleLLMEnd(
		output: HandleLLMEndParameters[0],
		runId: HandleLLMEndParameters[1],
		parentRunId?: HandleLLMEndParameters[2],
		tags?: HandleLLMEndParameters[3],
	) {
		try {
			// Get/create container
			const container = this.getContainer(runId, parentRunId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for generation");
				return;
			}

			// Process entity-specific logic
			const result = convertLLMResultToCompletionResult(output);

			// Handle tags
			addParsedTagsToLogger(tags, (key, value) => this.logger.generationAddTag(runId, key, value));

			this.logger.generationResult(runId, result);

			if (!container.parentId) {
				this.containerManager.removeRunIdMapping(runId);
			}
		} catch (e) {
			console.error("[MaximSDK] Error while processing LLM end", e);
		}
	}

	override handleLLMError(
		err: HandleLLMErrorParameters[0],
		runId: HandleLLMErrorParameters[1],
		parentRunId?: HandleLLMErrorParameters[2],
		tags?: HandleLLMErrorParameters[3],
	) {
		try {
			// Get/create container
			const container = this.getContainer(runId, parentRunId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for generation");
				return;
			}

			// Handle tags
			addParsedTagsToLogger(tags, (key, value) => this.logger.generationAddTag(runId, key, value));

			// Process entity-specific logic
			const generationError = parseLangchainErrorToMaximError(err);
			this.logger.generationError(runId, generationError);

			if (!container.parentId) {
				this.containerManager.removeRunIdMapping(runId);
			}
		} catch (e) {
			console.error("[MaximSDK] Error while processing LLM error", e);
		}
	}

	override async handleChatModelStart(
		llm: HandleChatModelStartParameters[0],
		messages: HandleChatModelStartParameters[1],
		runId: HandleChatModelStartParameters[2],
		parentRunId?: HandleChatModelStartParameters[3],
		extraParams?: HandleChatModelStartParameters[4],
		tags?: HandleChatModelStartParameters[5],
		metadata?: HandleChatModelStartParameters[6],
		runName?: HandleChatModelStartParameters[7],
	): Promise<void> {
		try {
			// Process metadata
			const maximMetadata = this.getMetadataClassFromRecord(metadata);

			// Get/create container
			const container = this.getContainer(runId, parentRunId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for chat model");
				return;
			}

			// Check container creation status
			if (!container.isCreated()) {
				container.create();
			}

			// Process entity-specific logic
			const parsedMessages = parseLangchainMessages(messages);
			const traceContainer = container.getTraceContainer();
			if (traceContainer && traceContainer instanceof TraceContainer) {
				let lastUserInput = "";

				const lastUserMessage = parsedMessages.findLast((m) => m.role === "user");
				if (lastUserMessage) {
					if (typeof lastUserMessage.content === "string") {
						lastUserInput = lastUserMessage.content;
					} else if (Array.isArray(lastUserMessage.content)) {
						const textParts = lastUserMessage.content
							.filter((item) => item.type === "text")
							.map((item) => item.text || "")
							.join(" ");
						if (textParts) {
							lastUserInput = textParts;
						}
					}
				}

				// Set trace input if we found user input
				if (lastUserInput) {
					traceContainer.setInput(lastUserInput);
				}
			}

			const generationName = maximMetadata?.generationName ?? runName ?? "default-generation";
			const [model, modelParameters] = parseLangchainModelAndParameters(metadata, extraParams);
			const generationConfig: GenerationConfig = {
				id: runId,
				name: generationName,
				provider: determineProvider(llm.id, metadata),
				model,
				messages: parsedMessages,
				modelParameters,
				tags: parseLangchainTags(maximMetadata?.generationTags, tags),
			};

			container.addGeneration(generationConfig);

			// Manage container lifecycle
			if (!container.parentId) {
				this.containerManager.setContainer(runId, container);
			}
		} catch (e) {
			console.error("[MaximSDK] Error while processing chat model start", e);
		}
	}

	override handleRetrieverStart(
		_retriever: HandleRetrieverStartParameters[0],
		query: HandleRetrieverStartParameters[1],
		runId: HandleRetrieverStartParameters[2],
		parentRunId?: HandleRetrieverStartParameters[3],
		tags?: HandleRetrieverStartParameters[4],
		metadata?: HandleRetrieverStartParameters[5],
		name?: HandleRetrieverStartParameters[6],
	) {
		try {
			// Process metadata
			const maximMetadata = this.getMetadataClassFromRecord(metadata);

			// Get/create container
			const container = this.getContainer(runId, parentRunId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for retrieval");
				return;
			}

			// Check container creation status
			if (!container.isCreated()) {
				container.create();
			}

			// Process entity-specific logic
			const retrievalId = runId;
			const retrievalName = maximMetadata?.retrievalName ?? name ?? "default-retrieval";
			const retrievalConfig: RetrievalConfig = {
				id: retrievalId,
				name: retrievalName,
				tags: parseLangchainTags(maximMetadata?.retrievalTags, tags),
			};

			const retrieval = container.addRetrieval(retrievalConfig);
			retrieval.input(query);

			// Manage container lifecycle
			if (!container.parentId) {
				this.containerManager.setContainer(runId, container);
			}
		} catch (e) {
			console.error("[MaximSDK] Error while processing retriever start", e);
		}
	}

	override handleRetrieverEnd(
		documents: HandleRetrieverEndParameters[0],
		runId: HandleRetrieverEndParameters[1],
		parentRunId?: HandleRetrieverEndParameters[2],
		tags?: HandleRetrieverEndParameters[3],
	) {
		try {
			// Get/create container
			const container = this.getContainer(runId, parentRunId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for retrieval");
				return;
			}

			// Handle tags
			addParsedTagsToLogger(tags, (key, value) => this.logger.retrievalAddTag(runId, key, value));

			// Process entity-specific logic
			this.logger.retrievalOutput(runId, this.safeStringify(documents));

			if (!container.parentId) {
				this.containerManager.removeRunIdMapping(runId);
			}
		} catch (e) {
			console.error("[MaximSDK] Error while processing retriever end", e);
		}
	}

	override handleToolStart(
		tool: HandleToolStartParameters[0],
		input: HandleToolStartParameters[1],
		runId: HandleToolStartParameters[2],
		parentRunId?: HandleToolStartParameters[3],
		tags?: HandleToolStartParameters[4],
		metadata?: HandleToolStartParameters[5],
		runName?: HandleToolStartParameters[6],
	) {
		try {
			// Process metadata
			const maximMetadata = this.getMetadataClassFromRecord(metadata);

			// Get/create container
			const container = this.getContainer(runId, parentRunId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for tool");
				return;
			}

			// Check container creation status
			if (!container.isCreated()) {
				container.create();
			}

			// Process entity-specific logic
			const name = maximMetadata?.toolCallName ?? runName ?? tool.name ?? "default-tool";
			const description = "description" in tool ? (tool.description as string) : "";
			const toolCallConfig: ToolCallConfig = {
				id: runId,
				name,
				description,
				args: input,
				tags: parseLangchainTags(maximMetadata?.toolCallTags, tags),
			};

			container.addToolCall(toolCallConfig);

			// Manage container lifecycle
			if (!container.parentId) {
				this.containerManager.setContainer(runId, container);
			}
		} catch (e) {
			console.error("[MaximSDK] Failed to parse tool-start:", e);
		}
	}

	override handleToolEnd(
		output: HandleToolEndParameters[0],
		runId: HandleToolEndParameters[1],
		parentRunId?: HandleToolEndParameters[2],
		tags?: HandleToolEndParameters[3],
	) {
		try {
			// Get/create container
			const container = this.getContainer(runId, parentRunId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for tool");
				return;
			}

			// Handle tags
			addParsedTagsToLogger(tags, (key, value) => this.logger.toolCallAddTag(runId, key, value));

			// Process entity-specific logic - handle different output formats
			if (isToolMessage(output)) {
				// Handle different possible output formats from LangChain
				if (output.status) {
					// Status-based output format
					if (output.status === "success") {
						this.logger.toolCallResult(runId, typeof output.content === "string" ? output.content : this.safeStringify(output.content));
					} else if (output.status === "error") {
						this.logger.toolCallError(runId, {
							message: typeof output.content === "string" ? output.content : this.safeStringify(output.content),
						});
					}
				} else {
					// Fallback: stringify the entire output
					this.logger.toolCallResult(runId, typeof output.content === "string" ? output.content : this.safeStringify(output.content));
				}
			} else {
				// Fallback for any other type
				this.logger.toolCallResult(
					runId,
					typeof output === "function" ||
						typeof output === "object" ||
						typeof output === "symbol" ||
						typeof output === "undefined" ||
						output === null
						? this.safeStringify(output)
						: String(output),
				);
			}

			if (!container.parentId) {
				this.containerManager.removeRunIdMapping(runId);
			}
		} catch (e) {
			console.error("[MaximSDK] Failed to parse tool-end:", e);
		}
	}

	override handleToolError(
		error: HandleToolErrorParameters[0],
		runId: HandleToolErrorParameters[1],
		parentRunId?: HandleToolErrorParameters[2],
		tags?: HandleToolErrorParameters[3],
	) {
		try {
			// Get/create container
			const container = this.getContainer(runId, parentRunId);
			if (!container) {
				console.error("[MaximSDK] Couldn't find a container for tool");
				return;
			}

			// Handle tags
			addParsedTagsToLogger(tags, (key, value) => this.logger.toolCallAddTag(runId, key, value));

			// Process entity-specific logic
			const toolCallError = parseLangchainErrorToMaximError(error);
			this.logger.toolCallError(runId, toolCallError);

			if (!container.parentId) {
				this.containerManager.removeRunIdMapping(runId);
			}
		} catch (e) {
			console.error("[MaximSDK] Failed to parse tool-end:", e);
		}
	}
}
