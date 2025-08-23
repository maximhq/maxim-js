import { LogWriter } from "../writer";
import { BaseContainer } from "./base";
import { Entity } from "./types";

/**
 * Configuration object for tool call.
 */
export interface ToolCallConfig {
	id: string;
	name: string;
	description: string;
	args: string;
	tags?: Record<string, string>;
}

/**
 * Error information for failed tool call executions.
 */
export interface ToolCallError {
	message: string;
	code?: string;
	type?: string;
}

/**
 * Represents a function or tool call.
 *
 * Tool calls capture the invocation of external APIs, internal functions,
 * or any callable operations made via tool calls in your AI application.
 * They track the complete lifecycle including arguments, results, timing, and
 * errors.
 *
 * @class ToolCall
 * @extends BaseContainer
 * @example
 * const toolCallArgs = {
 *   userId: '12345',
 *   fields: ['name', 'email', 'preferences']
 * };
 *
 * const toolCall = container.toolCall({
 *   id: 'database-query-001',
 *   name: 'query_user_database',
 *   description: 'Queries the user database for customer information',
 *   args: JSON.stringify(toolCallArgs),
 * });
 *
 * // Execute and record result
 * try {
 *   const userData = await query(toolCallArgs);
 *   toolCall.result(JSON.stringify(userData));
 * } catch (error) {
 *   toolCall.error({
 *     message: error.message,
 *     code: 'DB_CONNECTION_ERROR',
 *     type: 'DatabaseError'
 *   });
 * }
 */
export class ToolCall extends BaseContainer {
	private readonly args: string;
	private readonly description: string;

	/**
	 * Creates a new tool call log entry.
	 *
	 * @param config - Configuration object defining the tool call
	 * @param writer - Log writer instance for persisting tool call data
	 * @example
	 * const toolCall = container.toolCall({
	 *   id: 'api-call-001',
	 *   name: 'get_user_profile',
	 *   description: 'Fetches user profile data from the database',
	 *   args: JSON.stringify({ userId: '12345', fields: ['name', 'email'] }),
	 * });
	 */
	constructor(config: ToolCallConfig, writer: LogWriter) {
		super(Entity.TOOL_CALL, config, writer);
		this.args = config.args;
		this.description = config.description;
	}

	/**
	 * Records the successful result of this tool call and ends it.
	 *
	 * @param result - The result returned by the tool as a string
	 * @returns void
	 * @example
	 * toolCall.result(JSON.stringify({
	 *   userId: '12345',
	 *   name: 'John Doe',
	 *   email: 'john@example.com'
	 * }));
	 */
	public result(result: string): void {
		this.commit("result", { result });
		this.end();
	}

	/**
	 * Static method to record a result for any tool call by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The tool call ID
	 * @param result - The result returned by the tool
	 * @returns void
	 */
	public static result_(writer: LogWriter, id: string, result: string): void {
		BaseContainer.commit_(writer, Entity.TOOL_CALL, id, "result", { result });
		BaseContainer.end_(writer, Entity.TOOL_CALL, id);
	}

	/**
	 * Records an error that occurred during this tool call and ends it.
	 *
	 * @param error - Error information including message, code, and type
	 * @returns void
	 * @example
	 * toolCall.error({
	 *   message: 'Database connection failed',
	 *   code: 'DB_CONNECTION_ERROR',
	 *   type: 'DatabaseError'
	 * });
	 */
	public error(error: ToolCallError): void {
		this.commit("error", { error });
		this.end();
	}

	/**
	 * Static method to record an error for any tool call by ID.
	 *
	 * @param writer - The log writer instance
	 * @param id - The tool call ID
	 * @param error - Error information
	 * @returns void
	 */
	public static error_(writer: LogWriter, id: string, error: ToolCallError): void {
		BaseContainer.commit_(writer, Entity.TOOL_CALL, id, "error", { error });
		BaseContainer.end_(writer, Entity.TOOL_CALL, id);
	}

	/**
	 * Returns the complete data representation of this tool call.
	 *
	 * @returns Tool call data.
	 * @example
	 * const toolData = toolCall.data();
	 */
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
