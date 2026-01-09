import type OpenAI from "openai";
import type { MaximLogger } from "../logger";
import { MaximOpenAIChat } from "./chat";
import { MaximOpenAIResponses } from "./responses";

/**
 * A wrapped OpenAI client that automatically logs all chat completions and responses to Maxim.
 *
 * This class provides the same interface as the OpenAI client but with automatic
 * logging of traces and generations for observability purposes.
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { Maxim } from '@maximai/maxim-js';
 * import { MaximOpenAIClient } from '@maximai/maxim-js/openai';
 *
 * const maxim = new Maxim({ apiKey: process.env.MAXIM_API_KEY });
 * const logger = await maxim.logger({ id: 'my-app' });
 *
 * const openai = new OpenAI();
 * const client = new MaximOpenAIClient(openai, logger);
 *
 * // Automatically logged to Maxim
 * const response = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With custom trace ID
 * const response = await client.chat.completions.create(
 *   {
 *     model: 'gpt-4',
 *     messages: [{ role: 'user', content: 'Hello!' }]
 *   },
 *   {
 *     headers: {
 *       'x-maxim-trace-id': 'my-custom-trace-id',
 *       'x-maxim-generation-name': 'greeting-generation'
 *     }
 *   }
 * );
 * ```
 *
 * @example
 * ```typescript
 * // Streaming with automatic logging
 * const stream = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Tell me a story' }],
 *   stream: true
 * });
 *
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.choices[0]?.delta?.content || '');
 * }
 * // Logging happens automatically when stream completes
 * ```
 *
 * @example
 * ```typescript
 * // Using Responses API (non-streaming)
 * const response = await client.responses.create({
 *   model: 'gpt-4.1',
 *   input: 'What is the meaning of life?'
 * });
 *
 * // Using Responses API (streaming)
 * const stream = await client.responses.stream({
 *   model: 'gpt-4.1',
 *   input: 'Tell me a story'
 * });
 * for await (const event of stream) {
 *   // process events
 * }
 * // Logging happens automatically when stream completes
 * ```
 */
export class MaximOpenAIClient {
	private _chat: MaximOpenAIChat;
	private _responses: MaximOpenAIResponses;

	/**
	 * Creates a new MaximOpenAIClient.
	 *
	 * @param client - The OpenAI client instance to wrap.
	 * @param logger - The MaximLogger instance to use for logging.
	 */
	constructor(
		private client: OpenAI,
		private logger: MaximLogger,
	) {
		this._chat = new MaximOpenAIChat(client, logger);
		this._responses = new MaximOpenAIResponses(client, logger);
	}

	/**
	 * Access the chat resource with automatic Maxim logging.
	 */
	get chat(): MaximOpenAIChat {
		return this._chat;
	}

	/**
	 * Access the responses resource with automatic Maxim logging.
	 */
	get responses(): MaximOpenAIResponses {
		return this._responses;
	}
}
