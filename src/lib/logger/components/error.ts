import { ILogWriter } from "../types";
import { BaseContainer } from "./base";
import { Entity } from "./types";

/**
 * Configuration object for error.
 */
export type ErrorConfig = {
	id: string;
	message: string;
	code?: string;
	name?: string;
	type?: string;
	tags?: Record<string, string>;
	metadata?: Record<string, any>;
};

/**
 * Represents an error or exception that occurred within the trace.
 *
 * The Error class captures detailed information about failures, exceptions,
 * and error conditions, providing context for debugging and monitoring.
 *
 * @class Error
 * @extends BaseContainer
 * @example
 * const error = container.error({
 *   id: 'err-001',
 *   message: 'Failed to connect to external API',
 *   code: 'CONNECTION_TIMEOUT',
 *   type: 'NetworkError',
 * });
 *
 * @example
 * // Capturing JavaScript errors
 * try {
 *   await riskyOperation();
 * } catch (err) {
 *   const error = container.error({
 *     id: 'operation-failure',
 *     message: err.message,
 *     name: err.name,
 *     type: 'JavaScriptError',
 *   });
 * }
 */
export class Error extends BaseContainer {
	protected message: string;
	protected code?: string;
	protected errorType?: string;
	protected name?: string;

	/**
	 * Creates a new error log entry.
	 *
	 * @param config - Configuration object defining the error details
	 * @param writer - Log writer instance for persisting the error
	 * @example
	 * const error = container.error({
	 *   id: 'validation-error',
	 *   message: 'Invalid input parameters',
	 *   code: 'VALIDATION_FAILED',
	 *   type: 'ValidationError',
	 * });
	 */
	constructor(config: ErrorConfig, writer: ILogWriter) {
		super(Entity.ERROR, config, writer);
		this.message = config.message;
		this.code = config.code;
		this.errorType = config.type;
		this.name = config.name;
	}

	/**
	 * Returns the complete data representation of this error.
	 *
	 * @returns Error data
	 * @example
	 * const errorData = error.data();
	 */
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
