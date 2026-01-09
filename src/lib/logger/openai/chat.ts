import type OpenAI from "openai";
import type { MaximLogger } from "../logger";
import { MaximOpenAIChatCompletions } from "./completions";

/**
 * Wrapped OpenAI Chat resource that provides Maxim-instrumented completions.
 *
 * @example
 * ```typescript
 * const chat = new MaximOpenAIChat(openaiClient, logger);
 * const response = await chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 * ```
 */
export class MaximOpenAIChat {
	private _completions: MaximOpenAIChatCompletions;

	constructor(
		private client: OpenAI,
		private logger: MaximLogger,
	) {
		this._completions = new MaximOpenAIChatCompletions(client, logger);
	}

	/**
	 * Access the completions resource with automatic Maxim logging.
	 */
	get completions(): MaximOpenAIChatCompletions {
		return this._completions;
	}
}
