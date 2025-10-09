import type { Span as AgentsSpan, Trace as AgentsTrace, TracingProcessor } from "@openai/agents";
import { SpanData } from "@openai/agents-core/dist/tracing/spans";
import { v4 as uuid } from "uuid";
import type { ChatCompletionMessage, CompletionRequest } from "../../models/prompt";
import type {
	ChatCompletionResult,
	Generation as MaximGeneration,
	Span as MaximSpan,
	ToolCall as MaximToolCall,
	Trace as MaximTrace,
	TextCompletionResult,
} from "../components";
import type { MaximLogger } from "../logger";
import { convertOpenAIResponsesMessagesToCompletionMessages, convertOpenAIResponsesToCompletionResult } from "./utils";

type TraceState = {
	trace: MaximTrace;
	topSpan: MaximSpan;
	createdByUs: boolean;
};

/**
 * A tracing processor for the OpenAI Agents SDK that forwards trace and span
 * lifecycle events into Maxim.
 *
 * @example
 * ```ts
 * import { addTraceProcessor, setTraceProcessors } from "@openai/agents";
 * import { Maxim } from "@maximai/maxim-js";
 * import { MaximOpenAIAgentsProcessor } from "@maximai/maxim-js/openai-agents";
 *
 * const maxim = new Maxim({ apiKey: process.env.MAXIM_API_KEY! });
 * const logger = await maxim.logger({ id: "my-app" });
 *
 * // Add alongside the default OpenAI exporter
 * addTraceProcessor(new MaximOpenAIAgentsProcessor(logger));
 *
 * // Or replace all processors (disables default OpenAI exporter)
 * // setTraceProcessors([new MaximOpenAIAgentsProcessor(logger)]);
 * ```
 *
 * Trace metadata recognized on the OpenAI Agents trace
 * (only `traceTags`, `traceMetadata`, and `traceMetrics` are read at both onTraceStart and onTraceEnd, the rest is only read at onTraceStart):
 * - `traceId`: string — override the Maxim trace id (default: Agent's `traceId`)
 * - `traceName`: string — set the Maxim trace name
 * - `traceSessionId`: string — associate the trace to a session
 * - `traceTags`: Record<string,string> — tags to add on the trace
 * - `traceMetadata`: Record<string,unknown> — metadata to add on the trace
 * - `traceMetrics`: Record<string,number> — numeric metrics to add on the trace
 * - `traceSpanId`: string — id for the single top-level span
 * - `traceSpanName`: string — name for the top-level span
 * - `traceSpanTags`: Record<string,string> — tags for the top-level span
 *
 * Unsupported span types:
 * - "speech" | "transcription" | "speech_group" (currently ignored)
 *
 * Notes:
 * - No automatic flush is performed. Manage shutdown/flush in your app
 *   lifecycle (e.g., `await maxim.cleanup()`).
 */
export class MaximOpenAIAgentsProcessor implements TracingProcessor {
	private readonly logger: MaximLogger;
	private readonly traceStates = new Map<string, TraceState>();
	private readonly spanStates = new Map<string, MaximSpan>();
	private readonly generationStates = new Map<string, MaximGeneration>();
	private readonly toolCallStates = new Map<string, MaximToolCall>();

	constructor(logger: MaximLogger) {
		this.logger = logger;
	}

	async shutdown(): Promise<void> {
		await this.logger.cleanup();
	}

	async forceFlush(): Promise<void> {
		await this.logger.flush();
	}

	async onTraceStart(trace: AgentsTrace): Promise<void> {
		const traceId = trace.metadata?.["traceId"] ?? trace.traceId;
		const traceName = trace.metadata?.["traceName"] ?? ("name" in trace ? trace.name : undefined) ?? "agents-trace";

		const maximTrace = this.logger.trace({
			id: traceId,
			name: traceName,
			tags: trace.metadata?.["traceTags"],
			sessionId: trace.metadata?.["traceSessionId"],
		});

		if (trace.metadata?.["traceMetadata"]) {
			this.logger.traceMetadata(traceId, trace.metadata["traceMetadata"]);
		}

		if (trace.metadata?.["traceMetrics"]) {
			for (const [k, v] of Object.entries(trace.metadata["traceMetrics"])) {
				if (typeof v === "number") {
					this.logger.traceAddMetric(traceId, k, v);
				} else {
					console.warn(`Skipping trace metric ${k} with value ${v} because it is not a number`);
				}
			}
		}

		// Create a single top-level span per trace
		const spanId = trace.metadata?.["traceSpanId"] ?? uuid();
		const spanName = trace.metadata?.["traceSpanName"] ?? "agent-run";
		const topSpan = maximTrace.span({ id: spanId, name: spanName, tags: trace.metadata?.["traceSpanTags"] });

		// store state
		this.traceStates.set(trace.traceId, { trace: maximTrace, topSpan, createdByUs: true });
	}

	async onTraceEnd(trace: AgentsTrace): Promise<void> {
		const state = this.traceStates.get(trace.traceId);
		if (!state) return;

		// Use the Maxim trace id from traceState if provided, otherwise fall back to the Agents traceId
		const maximId = state.trace.id ?? trace.traceId;

		if (trace.metadata?.["traceTags"]) {
			for (const [k, v] of Object.entries(trace.metadata["traceTags"])) {
				if (typeof v === "string") {
					this.logger.traceTag(maximId, k, v);
				} else {
					console.warn(`Skipping trace tag ${k} with value ${v} because it is not a string`);
				}
			}
		}
		if (trace.metadata?.["traceMetadata"]) {
			this.logger.traceMetadata(maximId, trace.metadata["traceMetadata"]);
		}
		if (trace.metadata?.["traceMetrics"]) {
			for (const [k, v] of Object.entries(trace.metadata["traceMetrics"])) {
				if (typeof v === "number") {
					this.logger.traceAddMetric(maximId, k, v);
				} else {
					console.warn(`Skipping trace metric ${k} with value ${v} because it is not a number`);
				}
			}
		}

		// End the top-level span if still open
		this.logger.spanEnd(state.topSpan.id);

		// End trace
		this.logger.traceEnd(state.trace.id);

		// cleanup state
		this.traceStates.delete(trace.traceId);
	}

	async onSpanStart(span: AgentsSpan<SpanData>): Promise<void> {
		const traceState = this.traceStates.get(span.traceId);
		if (!traceState) {
			console.warn(`onSpanStart called for span ${span.spanId} but no trace state found`);
			return;
		}

		const data = span.spanData;
		const topSpanId = traceState.topSpan.id;

		if (span.error) {
			this.logger.spanError(span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId, {
				id: uuid(),
				message: span.error.message,
				metadata: span.error.data,
			});
		}

		if (data.type === "agent") {
			const child = this.logger.spanSpan(span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId, {
				id: span.spanId,
				name: data.name,
			});

			if (data.handoffs) {
				child.addMetadata({ handoffs: data.handoffs });
			}
			if (data.output_type) {
				child.addMetadata({ output_type: data.output_type });
			}
			if (data.tools) {
				child.addMetadata({ tools: data.tools });
			}

			this.spanStates.set(span.spanId, child);

			return;
		}

		if (data.type === "generation") {
			const model = data.model ?? "openai";

			const generation = this.logger.spanGeneration(span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId, {
				id: span.spanId,
				provider: "openai",
				model,
				messages: data.input as (CompletionRequest | ChatCompletionMessage)[],
				modelParameters: data.model_config ?? {},
			});

			this.generationStates.set(span.spanId, generation);

			return;
		}

		if (data.type === "response") {
			const messages: (CompletionRequest | ChatCompletionMessage)[] =
				typeof data._input === "string"
					? [{ role: "user", content: data._input }]
					: Array.isArray(data._input)
					? convertOpenAIResponsesMessagesToCompletionMessages(data._input)
					: [];

			const generation = this.logger.spanGeneration(span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId, {
				id: span.spanId,
				provider: "openai",
				model: "unknown",
				messages,
				modelParameters: {},
			});

			this.generationStates.set(span.spanId, generation);

			return;
		}

		if (data.type === "function") {
			const tool = this.logger.spanToolCall(span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId, {
				id: span.spanId,
				name: data.name,
				description: data.name,
				args: data.input,
			});

			if (data.mcp_data) {
				tool.addMetadata({ mcp_data: data.mcp_data });
			}

			if (data.output) {
				tool.result(data.output);
				tool.end();
			} else {
				this.toolCallStates.set(span.spanId, tool);
			}

			return;
		}

		if (data.type === "mcp_tools") {
			const tool = this.logger.spanToolCall(span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId, {
				id: span.spanId,
				name: data.server ?? "unknown_mcp_tool_server",
				description: data.server ?? "unknown_mcp_tool_server",
				args: "",
			});

			if (data.result) {
				tool.result(JSON.stringify(data.result, null, 2));
				tool.end();
			} else {
				this.toolCallStates.set(span.spanId, tool);
			}

			return;
		}

		if (data.type === "guardrail") {
			this.logger.spanEvent(
				span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId,
				span.spanId,
				data.name,
				{
					triggered: data.triggered ? "true" : "false",
					type: data.type,
				},
				undefined,
			);
			return;
		}

		if (data.type === "handoff") {
			this.logger.spanEvent(
				span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId,
				span.spanId,
				`Handoff: ${data.from_agent ?? "unknown_agent"}<>${data.to_agent ?? "unknown_agent"}`,
				{ type: data.type, from_agent: data.from_agent ?? "unknown_agent", to_agent: data.to_agent ?? "unknown_agent" },
				undefined,
			);
			return;
		}

		if (data.type === "custom") {
			this.logger.spanEvent(
				span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId,
				span.spanId,
				data.name,
				{},
				{ data: data.data },
			);
			return;
		}

		// For other kinds, do nothing
		// Not Handled by Maxim: "speech" | "transcription" | "speech_group"
	}

	async onSpanEnd(span: AgentsSpan<SpanData>): Promise<void> {
		const traceState = this.traceStates.get(span.traceId);
		if (!traceState) {
			console.warn(`onSpanEnd called for span ${span.spanId} but no trace state found`);
			return;
		}

		const data = span.spanData;
		const topSpanId = traceState.topSpan.id;

		if (span.error) {
			this.logger.spanError(span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId, {
				id: uuid(),
				message: span.error.message,
				metadata: span.error.data,
			});
		}

		if (data.type === "agent") {
			const childToEnd = this.spanStates.get(span.spanId);
			if (!childToEnd) {
				console.warn(`onSpanEnd called for span ${span.spanId} but no child span found`);
				return;
			}

			if (data.handoffs) {
				childToEnd.addMetadata({ handoffs: data.handoffs });
			}
			if (data.output_type) {
				childToEnd.addMetadata({ output_type: data.output_type });
			}
			if (data.tools) {
				childToEnd.addMetadata({ tools: data.tools });
			}

			childToEnd.end();
			this.spanStates.delete(span.spanId);

			return;
		}

		if (data.type === "generation") {
			const generationToEnd = this.generationStates.get(span.spanId);
			if (!generationToEnd) {
				console.warn(`onSpanEnd called for span ${span.spanId} but no generation found`);
				return;
			}

			if (data.output && data.output.length > 0) {
				generationToEnd.result(data.output.at(-1) as TextCompletionResult | ChatCompletionResult);
			}

			generationToEnd.end();
			this.generationStates.delete(span.spanId);

			return;
		}

		if (data.type === "response") {
			const generationToEnd = this.generationStates.get(span.spanId);
			if (!generationToEnd) {
				console.warn(`onSpanEnd called for span ${span.spanId} but no generation found`);
				return;
			}

			if (data._input) {
				const messages: (CompletionRequest | ChatCompletionMessage)[] =
					typeof data._input === "string"
						? [{ role: "user", content: data._input }]
						: Array.isArray(data._input)
						? convertOpenAIResponsesMessagesToCompletionMessages(data._input)
						: [];
				if (messages.length) {
					generationToEnd.addMessages(messages);
				}
			}

			if (data._response) {
				const { completionResult, modelParameters } = convertOpenAIResponsesToCompletionResult(data._response);
				if (completionResult.model) {
					generationToEnd.setModel(completionResult.model);
				}
				if (modelParameters && Object.keys(modelParameters).length > 0) {
					generationToEnd.setModelParameters(modelParameters);
				}
				generationToEnd.result(completionResult);
			}

			if (data.response_id) {
				generationToEnd.addTag("response_id", data.response_id);
			}

			generationToEnd.end();
			this.generationStates.delete(span.spanId);

			return;
		}

		if (data.type === "function") {
			const toolToEnd = this.toolCallStates.get(span.spanId);
			if (!toolToEnd) {
				console.warn(`onSpanEnd called for span ${span.spanId} but no tool call found`);
				return;
			}

			if (data.mcp_data) {
				toolToEnd.addMetadata({ mcp_data: data.mcp_data });
			}

			if (data.output) {
				toolToEnd.result(data.output);
			}

			toolToEnd.end();
			this.toolCallStates.delete(span.spanId);

			return;
		}

		if (data.type === "mcp_tools") {
			const toolToEnd = this.toolCallStates.get(span.spanId);
			if (!toolToEnd) {
				console.warn(`onSpanEnd called for span ${span.spanId} but no tool call found`);
				return;
			}

			if (data.result) {
				toolToEnd.result(JSON.stringify(data.result, null, 2));
			}

			toolToEnd.end();
			this.toolCallStates.delete(span.spanId);

			return;
		}

		if (data.type === "guardrail") {
			this.logger.spanEvent(
				span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId,
				span.spanId,
				data.name,
				{
					triggered: data.triggered ? "true" : "false",
					type: data.type,
				},
				undefined,
			);
			return;
		}

		if (data.type === "handoff") {
			this.logger.spanEvent(
				span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId,
				span.spanId,
				`Handoff: ${data.from_agent ?? "unknown_agent"}<>${data.to_agent ?? "unknown_agent"}`,
				{ type: data.type, from_agent: data.from_agent ?? "unknown_agent", to_agent: data.to_agent ?? "unknown_agent" },
				undefined,
			);
			return;
		}

		if (data.type === "custom") {
			this.logger.spanEvent(
				span.traceId !== span.parentId && span.parentId ? span.parentId : topSpanId,
				span.spanId,
				data.name,
				{},
				{ data: data.data },
			);
			return;
		}

		// For other kinds, do nothing
		// Not Handled by Maxim: "speech" | "transcription" | "speech_group"
	}
}
