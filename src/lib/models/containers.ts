/**
 * Models for LangChain logging and tracing functionality.
 * This module contains data models used for tracking and logging LangChain operations,
 * including metadata storage and run information.
 */

import {
	Generation,
	GenerationConfig,
	MaximLogger,
	Retrieval,
	RetrievalConfig,
	Span,
	SpanConfig,
	ToolCall,
	ToolCallConfig,
	TraceConfig,
} from "../../../index";

export interface MaximMetadata {
	sessionId?: string;
	traceId?: string;
	spanId?: string;
	chainName?: string;
	spanName?: string;
	traceName?: string;
	generationName?: string;
	retrievalName?: string;
	toolCallName?: string;
	generationTags?: Record<string, string>;
	retrievalTags?: Record<string, string>;
	toolCallTags?: Record<string, string>;
	traceTags?: Record<string, string>;
	chainTags?: Record<string, string>;
}

export const MetadataKeys = [
	"sessionId",
	"traceId",
	"spanId",
	"chainName",
	"spanName",
	"traceName",
	"generationName",
	"retrievalName",
	"toolCallName",
	"generationTags",
	"retrievalTags",
	"toolCallTags",
	"traceTags",
	"chainTags",
];

export class Metadata implements MaximMetadata {
	sessionId?: string;
	traceId?: string;
	spanId?: string;
	chainName?: string;
	spanName?: string;
	traceName?: string;
	generationName?: string;
	retrievalName?: string;
	toolCallName?: string;
	generationTags?: Record<string, string>;
	retrievalTags?: Record<string, string>;
	toolCallTags?: Record<string, string>;
	traceTags?: Record<string, string>;
	chainTags?: Record<string, string>;

	private _parseTagsField(value: unknown): Record<string, string> {
		if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value) &&
			Object.entries(value).every(([k, v]) => typeof k === "string" && typeof v === "string")
		) {
			return value as Record<string, string>;
		}
		if (typeof value === "string") {
			try {
				const parsed = JSON.parse(value);
				if (
					typeof parsed === "object" &&
					parsed !== null &&
					!Array.isArray(parsed) &&
					Object.entries(parsed).every(([k, v]) => typeof k === "string" && typeof v === "string")
				) {
					return parsed as Record<string, string>;
				}
			} catch {
				// ignore
			}
		}
		return {};
	}

	constructor(metadata?: Record<string, unknown>) {
		if (!metadata) return;

		this.sessionId = typeof metadata["sessionId"] === "string" ? metadata["sessionId"] : undefined;
		this.traceId = typeof metadata["traceId"] === "string" ? metadata["traceId"] : undefined;
		this.spanId = typeof metadata["spanId"] === "string" ? metadata["spanId"] : undefined;
		this.spanName = typeof metadata["spanName"] === "string" ? metadata["spanName"] : undefined;
		this.chainName = typeof metadata["chainName"] === "string" ? metadata["chainName"] : undefined;
		this.traceName = typeof metadata["traceName"] === "string" ? metadata["traceName"] : undefined;
		this.generationName = typeof metadata["generationName"] === "string" ? metadata["generationName"] : undefined;
		this.toolCallName = typeof metadata["toolCallName"] === "string" ? metadata["toolCallName"] : undefined;
		this.retrievalName = typeof metadata["retrievalName"] === "string" ? metadata["retrievalName"] : undefined;
		this.generationTags = this._parseTagsField(metadata["generationTags"]);
		this.retrievalTags = this._parseTagsField(metadata["retrievalTags"]);
		this.toolCallTags = this._parseTagsField(metadata["toolCallTags"]);
		this.traceTags = this._parseTagsField(metadata["traceTags"]);
		this.chainTags = this._parseTagsField(metadata["chainTags"]);
	}

	toJSON(): Record<string, any> {
		return {
			sessionId: this.sessionId,
			traceId: this.traceId,
			spanId: this.spanId,
			chainName: this.chainName,
			spanName: this.spanName,
			traceName: this.traceName,
			generationName: this.generationName,
			retrievalName: this.retrievalName,
			toolCallName: this.toolCallName,
			generationTags: this.generationTags,
			retrievalTags: this.retrievalTags,
			toolCallTags: this.toolCallTags,
			traceTags: this.traceTags,
			chainTags: this.chainTags,
		};
	}
}

/**
 * Container manager for efficient lookup and cleanup
 */
export class ContainerManager {
	private allContainers = new Map<string, Container>();
	private traceIdToContainerIds = new Map<string, Set<string>>(); // traceId -> set of container IDs
	private containerIdToTraceId = new Map<string, string>(); // containerId -> traceId

	addContainer(container: Container): void {
		this.allContainers.set(container.id, container);

		const traceId = container.getTraceId();
		if (traceId) {
			// Track which containers belong to which trace
			if (!this.traceIdToContainerIds.has(traceId)) {
				this.traceIdToContainerIds.set(traceId, new Set());
			}
			this.traceIdToContainerIds.get(traceId)!.add(container.id);
			this.containerIdToTraceId.set(container.id, traceId);
		} else if (container.parentId) {
			const traceIdFromParent = this.containerIdToTraceId.get(container.parentId);
			if (traceIdFromParent) {
				if (!this.traceIdToContainerIds.has(traceIdFromParent)) {
					this.traceIdToContainerIds.set(traceIdFromParent, new Set());
				}
				this.traceIdToContainerIds.get(traceIdFromParent)!.add(container.id);
				this.containerIdToTraceId.set(container.id, traceIdFromParent);
			}
		}
	}

	getContainer(id: string): Container | undefined {
		return this.allContainers.get(id);
	}

	setContainer(runId: string, container: Container): void {
		// Store the container under the runId for lookup
		this.allContainers.set(runId, container);

		// Update trace mappings only if this container isn't already tracked
		if (!this.allContainers.has(container.id)) {
			this.addContainer(container);
		}
	}

	deleteContainer(id: string): void {
		const container = this.allContainers.get(id);
		if (container) {
			this.removeContainer(container);
		}
	}

	getTraceContainer(containerId: string): Container | undefined {
		const traceId = this.containerIdToTraceId.get(containerId);
		return traceId ? this.allContainers.get(traceId) : undefined;
	}

	removeContainer(container: Container): void {
		this.allContainers.delete(container.id);

		const traceId = this.containerIdToTraceId.get(container.id);
		if (traceId) {
			this.containerIdToTraceId.delete(container.id);
			const traceContainers = this.traceIdToContainerIds.get(traceId);
			if (traceContainers) {
				traceContainers.delete(container.id);

				// If this was the last container in the trace, clean up trace mapping
				if (traceContainers.size === 0) {
					this.traceIdToContainerIds.delete(traceId);
				}
			}
		}
	}

	getContainersInTrace(traceId: string): string[] {
		const containers = this.traceIdToContainerIds.get(traceId);
		return containers ? Array.from(containers) : [];
	}

	isTraceComplete(traceId: string): boolean {
		const containers = this.traceIdToContainerIds.get(traceId);
		if (!containers) return true;

		// Check if all containers in the trace are ended (except the trace itself)
		for (const containerId of containers) {
			if (containerId === traceId) continue; // Skip the trace container itself
			const container = this.allContainers.get(containerId);
			if (container && !container.isEnded()) {
				return false;
			}
		}
		return true;
	}

	removeRunIdMapping(runId: string): void {
		// Get the container before removing the mapping
		const container = this.allContainers.get(runId);
		if (!container) return;

		// Remove the runId mapping
		this.allContainers.delete(runId);

		// Only handle trace containers since other container types have their own end callbacks
		if (container.type === "trace") {
			const traceId = container.getTraceId();
			if (traceId && this.isTraceComplete(traceId) && !container.hasActiveChildren()) {
				container.end();
			}
		}
	}
}

export abstract class Container {
	protected _created = false;
	protected _ended = false;
	private _activeChildCount = 0;

	constructor(
		protected containerManager: ContainerManager,
		protected readonly logger: MaximLogger,
		protected readonly _id: string,
		protected readonly _type: "trace" | "span",
		protected readonly _name?: string,
		protected _parentId?: string,
		markCreated = false,
	) {
		this._created = markCreated;
	}

	abstract create(tags?: Record<string, string>): void;

	get id() {
		return this._id;
	}

	get type() {
		return this._type;
	}

	get parentId() {
		return this._parentId;
	}

	set parentId(id: string | undefined) {
		this._parentId = id;
	}

	isCreated() {
		return this._created;
	}

	isEnded() {
		return this._ended;
	}

	incrementChildCount(): void {
		this._activeChildCount++;
	}

	decrementChildCount(): void {
		this._activeChildCount = Math.max(0, this._activeChildCount - 1);
	}

	hasActiveChildren(): boolean {
		return this._activeChildCount > 0;
	}

	abstract addGeneration(config: GenerationConfig): Generation;
	abstract addToolCall(config: ToolCallConfig): ToolCall;
	abstract addEvent(eventId: string, name: string, tags: Record<string, string>): void;
	abstract addSpan(config: SpanConfig): Span;
	abstract addRetrieval(config: RetrievalConfig): Retrieval;
	abstract addTags(tags: Record<string, string>): void;
	abstract addMetadata(metadata: Record<string, unknown>): void;
	abstract internalEnd(): void;

	end(): void {
		if (this._ended) return;

		this.internalEnd();
		this._ended = true;

		// Notify parent that this child has ended
		if (this.parentId) {
			const parent = this.containerManager.getContainer(this.parentId);
			if (parent) {
				parent.decrementChildCount();
			}
		}

		// Check if we should clean up parent containers
		this.cleanupIfComplete();
	}

	private cleanupIfComplete(): void {
		const traceId = this.getTraceId();
		if (!traceId) return;

		// If this is a trace and all its children are ended, clean it up
		if (this.type === "trace" && !this.hasActiveChildren()) {
			if (this.containerManager.isTraceComplete(traceId)) {
				this.containerManager.removeContainer(this);
			}
		}
		// If this is a span, check if its parent trace can be cleaned up
		else if (this.type === "span") {
			this.containerManager.removeContainer(this);

			// Check if parent trace is now complete
			const traceContainer = this.containerManager.getContainer(traceId);
			if (traceContainer && this.containerManager.isTraceComplete(traceId)) {
				traceContainer.end();
			}
		}
	}

	getTraceContainer() {
		return this.containerManager.getTraceContainer(this.id);
	}

	abstract getTraceId(): string | undefined;
}

export class TraceContainer extends Container {
	private _input: string | undefined;

	constructor(
		containerManager: ContainerManager,
		logger: MaximLogger,
		traceId: string,
		traceName?: string,
		parentId?: string,
		markCreated = false,
	) {
		super(containerManager, logger, traceId, "trace", traceName, parentId, markCreated);
		containerManager.addContainer(this);
	}

	create(tags?: Record<string, string>, sessionId?: string): void {
		const config: TraceConfig = {
			id: this.id,
			name: this._name,
			tags,
			sessionId,
		};

		this.logger.trace(config);
		this._created = true;
	}

	setInput(input: string): void {
		if (this._input) return;

		this.logger.traceInput(this.id, input);
		this._input = input;
	}

	addGeneration(config: GenerationConfig): Generation {
		return this.logger.traceGeneration(this.id, config);
	}

	addRetrieval(config: RetrievalConfig): Retrieval {
		return this.logger.traceRetrieval(this.id, config);
	}

	addEvent(eventId: string, name: string, tags: Record<string, string>): void {
		this.logger.traceEvent(this.id, eventId, name, tags);
	}

	addSpan(config: SpanConfig): Span {
		return this.logger.traceSpan(this.id, config);
	}

	addTags(tags: Record<string, string>): void {
		Object.entries(tags).forEach(([key, value]) => {
			this.logger.traceTag(this.id, key, value);
		});
	}

	addMetadata(metadata: Record<string, unknown>): void {
		this.logger.traceMetadata(this.id, metadata);
	}

	addToolCall(config: ToolCallConfig): ToolCall {
		return this.logger.traceToolCall(this.id, config);
	}

	internalEnd(): void {
		this.logger.traceEnd(this.id);
	}

	getTraceId(): string {
		return this.id;
	}
}

export class SpanContainer extends Container {
	private _parentTraceId: string | undefined;

	constructor(
		containerManager: ContainerManager,
		logger: MaximLogger,
		spanId: string,
		spanName?: string,
		parentId?: string,
		parentTraceId?: string,
		markCreated = false,
	) {
		super(containerManager, logger, spanId, "span", spanName, parentId, markCreated);
		this._parentTraceId = parentTraceId;

		containerManager.addContainer(this);

		// Increment parent's child count when creating a span
		if (parentId) {
			const parent = containerManager.getContainer(parentId);
			if (parent) {
				parent.incrementChildCount();
			}
		}
	}

	create(tags?: Record<string, string>): void {
		if (!this.parentId) {
			throw new Error("[MaximSDK] Span without a parent is invalid");
		}

		const config: SpanConfig = {
			id: this.id,
			name: this._name,
			tags,
		};

		this.logger.traceSpan(this.parentId, config);
		this._created = true;
	}

	addGeneration(config: GenerationConfig): Generation {
		return this.logger.spanGeneration(this.id, config);
	}

	addRetrieval(config: RetrievalConfig): Retrieval {
		return this.logger.spanRetrieval(this.id, config);
	}

	addEvent(eventId: string, name: string, tags: Record<string, string>): void {
		this.logger.spanEvent(this.id, eventId, name, tags);
	}

	addSpan(config: SpanConfig): Span {
		return this.logger.spanSpan(this.id, config);
	}

	addTags(tags: Record<string, string>): void {
		Object.entries(tags).forEach(([key, value]) => {
			this.logger.spanTag(this.id, key, value);
		});
	}

	addMetadata(metadata: Record<string, unknown>): void {
		this.logger.spanMetadata(this.id, metadata);
	}

	addToolCall(config: ToolCallConfig): ToolCall {
		return this.logger.spanToolCall(this.id, config);
	}

	internalEnd(): void {
		this.logger.spanEnd(this.id);
	}

	getTraceId(): string | undefined {
		return this._parentTraceId;
	}
}
