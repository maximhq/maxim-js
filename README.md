# Maxim SDK

![Maxim SDK Banner Image](https://cdn.getmaxim.ai/third-party/sdk.png)

This is JS/TS SDK for enabling Maxim observability. [Maxim](https://www.getmaxim.ai?ref=npm) is an enterprise grade evaluation and observability platform.

## How to integrate

### Install

```
npm install @maximai/maxim-js
```

### Initialize Maxim logger

```js
const maxim = new Maxim({ apiKey: "maxim-api-key" });
const logger = await maxim.logger({ id: "log-repository-id" });
```

### Start sending traces

```js
// Start a trace
logger.trace({ id: "trace-id" });
// Add a span
logger.traceSpan("trace-id", { id: "span-id", name: "Intent detection service" });
// Add llm call to this span
const generationId = uuid();
logger.spanGeneration("span-id", {
	id: generationId,
	name: "test-inference",
	model: "gpt-3.5-turbo-16k",
	messages: [
		{
			role: "user",
			content: "Hello, how are you?",
		},
	],
	modelParameters: {
		temperature: 3,
	},
	provider: "openai",
});
// Make the actual call to the LLM
const result = llm_call();
// Log back the result
logger.generationResult(generationId, result);
// Ending span
logger.spanEnd("span-id");
// Ending trace
logger.traceEnd("trace-id");
```

## Integrations with other frameworks

### LangChain

You can use the built-in `MaximLangchainTracer` to integrate Maxim observability with your LangChain and LangGraph applications.

#### Installation

The LangChain integration is available as an optional dependency. Install the required LangChain package:

```bash
npm install @langchain/core
```

#### ⚡ 2-Line Integration

Add comprehensive observability to your existing LangChain code with just **2 lines**:

```js
const maximTracer = new MaximLangchainTracer(logger);
const result = await chain.invoke(input, { callbacks: [maximTracer] });
```

That's it! No need to modify your existing chains, agents, or LLM calls.

#### Complete Setup Example

```js
import { MaximLangchainTracer } from "@maximai/maxim-js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

// Initialize Maxim (standard setup)
const maxim = new Maxim({ apiKey: "your-maxim-api-key" });
const logger = await maxim.logger({ id: "your-log-repository-id" });

// Step 1: Create the tracer
const maximTracer = new MaximLangchainTracer(logger);

// Your existing LangChain code remains unchanged
const prompt = ChatPromptTemplate.fromTemplate("What is {topic}?");
const model = new ChatOpenAI({ model: "gpt-3.5-turbo" });
const chain = prompt.pipe(model);

// Step 2: Add tracer to your invoke calls
const result = await chain.invoke({ topic: "AI" }, { callbacks: [maximTracer] });

// Alternative: Attach permanently to the chain
const chainWithTracer = chain.withConfig({ callbacks: [maximTracer] });
const result2 = await chainWithTracer.invoke({ topic: "machine learning" });
```

#### LangGraph Integration

```js
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MemorySaver } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Create a simple tool
const searchTool = tool(
	async ({ query }) => {
		// Your tool implementation
		return `Search results for: ${query}`;
	},
	{
		name: "search",
		schema: z.object({
			query: z.string(),
		}),
		description: "Search for information",
	},
);

// Create LangGraph agent
const checkpointer = new MemorySaver();
const agent = createReactAgent({
	llm: model,
	tools: [searchTool],
	checkpointSaver: checkpointer,
});

// Use the tracer with your graph
const result = await agent.invoke(
	{ messages: [{ role: "user", content: "Hello!" }] },
	{
		callbacks: [maximTracer],
		configurable: { thread_id: "conversation-1" },
	},
);
```

#### What gets tracked

The `MaximLangchainTracer` automatically captures:

- **Traces**: Top-level executions with input/output
- **Spans**: Chain executions (sequences, parallel operations, etc.)
- **Generations**: LLM calls with messages, model parameters, and responses
- **Retrievals**: Vector store and retriever operations
- **Tool Calls**: Function/tool executions
- **Errors**: Failed operations with error details

#### Supported Providers

The tracer automatically detects and supports:

- OpenAI (including Azure OpenAI)
- Anthropic
- Google (Vertex AI, Gemini)
- Amazon Bedrock
- Hugging Face
- Together AI
- Groq
- And more...

#### Custom Metadata

You can pass custom metadata through LangChain's metadata system to customize how your operations appear in Maxim. All Maxim-specific metadata should be nested under the `maxim` key:

```js
const result = await chain.invoke(
	{ topic: "AI" },
	{
		callbacks: [maximTracer],
		metadata: {
			maxim: {
				// Your Maxim-specific metadata here
			},
		},
	},
);
```

##### Available Metadata Fields

**Entity Naming**:

- `traceName` - Override the default trace name
- `chainName` - Override the default chain/span name
- `generationName` - Override the default LLM generation name
- `retrievalName` - Override the default retrieval operation name
- `toolCallName` - Override the default tool call name

**Entity Tagging**:

- `traceTags` - Add custom tags to the trace (object: `{key: value}`)
- `chainTags` - Add custom tags to chains/spans (object: `{key: value}`)
- `generationTags` - Add custom tags to LLM generations (object: `{key: value}`)
- `retrievalTags` - Add custom tags to retrieval operations (object: `{key: value}`)
- `toolCallTags` - Add custom tags to tool calls (object: `{key: value}`)

**ID References** (for linking to existing traces/sessions):

- `sessionId` - Link this trace to an existing session
- `traceId` - Use a specific trace ID
- `spanId` - Use a specific span ID

##### Complete Example

```js
const result = await chain.invoke(
	{ query: "What is machine learning?" },
	{
		callbacks: [maximTracer],
		metadata: {
			maxim: {
				// Custom names for better organization
				traceName: "ML Question Answering",

				// Custom tags for filtering and analytics
				traceTags: {
					category: "educational",
					priority: "high",
					version: "v2.1",
				},

				// Link to existing session (optional)
				sessionId: "user_session_123",
			},
			// You can also include non-Maxim metadata
			user_id: "user_123",
			request_id: "req_456",
		},
	},
);
```

##### Per-Component Examples

**For LLM calls**:

```js
const llmResult = await model.invoke("Explain quantum computing", {
	callbacks: [maximTracer],
	metadata: {
		maxim: {
			generationName: "Quantum Computing Explanation",
			generationTags: {
				topic: "quantum_computing",
				difficulty: "advanced",
				model: "gpt-4",
			},
		},
	},
});
```

**For retrievers**:

```js
const docs = await retriever.invoke("machine learning algorithms", {
	callbacks: [maximTracer],
	metadata: {
		maxim: {
			retrievalName: "ML Algorithm Search",
			retrievalTags: {
				index_name: "ml_papers",
				search_type: "semantic",
				top_k: "5",
			},
		},
	},
});
```

**For tool calls**:

```js
const toolResult = await tool.invoke(
	{ query: "weather in NYC" },
	{
		callbacks: [maximTracer],
		metadata: {
			maxim: {
				toolCallName: "Weather API Lookup",
				toolCallTags: {
					api: "openweather",
					location: "NYC",
					units: "metric",
				},
			},
		},
	},
);
```

##### Notes

- **Automatic fallbacks**: If you don't provide custom names, the tracer uses sensible defaults based on the LangChain component names
- **Session linking**: Use `sessionId` to group multiple traces under the same user session for better analytics

### AI SDK

AI SDK integration is available as an optional dependency. Install the required package:

```bash
npm install @ai-sdk/provider
```

Use the built-in `wrapMaximAISDKModel` function to wrap provider models and integrate Maxim observability and logging with your agents using AI SDK.

```ts
import { wrapMaximAISDKModel } from "@maximai/maxim-js/vercel-ai-sdk";

const model = wrapMaximAISDKModel(anthropic("claude-3-5-sonnet-20241022"), logger);
```

You can pass this wrapped model in your generation functions to enable logging integration with Maxim.

```ts
const query = "Hello";
const response = await generateText({
	model: model,
	prompt: query,
});
console.log("OpenAI response for generateText", response.text);
```

#### Custom metadata

You can customize the behavior of the operations in Maxim by passing in custom metadata. Use the `providerOptions` property to pass in an object with the key of `maxim` to use this behavior.

```ts
streamText({
	model: model,
	// other model parameters
	providerOptions: {
		maxim: {
			traceName: "custom-trace-name",
			traceTags: {
				type: "demo",
				priority: "high",
			},
		},
	},
});
```

##### Available metadata fields

**Entity Naming**:

- `sessionName` - Override the default session name
- `traceName` - Override the default trace name
- `spanName` - Override the default span name
- `generationName` - Override the default LLM generation name

**Entity Tagging**:

- `sessionTags` - Add custom tags to the session (object: `{key: value}`)
- `traceTags` - Add custom tags to the trace (object: `{key: value}`)
- `spanTags` - Add custom tags to span (object: `{key: value}`)
- `generationTags` - Add custom tags to LLM generations (object: `{key: value}`)

**ID References** (for linking to existing traces/sessions):

- `sessionId` - Link this trace to an existing session
- `traceId` - Use a specific trace ID
- `spanId` - Use a specific span ID

##### Note

You can get type-completion for the `maxim` metadata object using the `MaximVercelProviderMetadata` type from `@maximai/maxim-js/vercel-ai-sdk`

```ts
streamText({
	model: model,
	// other model parameters
	providerOptions: {
		maxim: {
			traceName: "custom-trace-name",
			traceTags: {
				type: "demo",
				priority: "high",
			},
		} as MaximVercelProviderMetadata,
	},
});
```

#### Complete example

```ts
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { MaximVercelProviderMetadata, wrapMaximAISDKModel } from "@maximai/maxim-js/vercel-ai-sdk";
// other imports

const logger = await maxim.logger({ id: repoId });
if (!logger) {
	throw new Error("Logger is not available");
}

const model = wrapMaximAISDKModel(openai.chat("gpt-4o-mini"), logger);
const spanId = uuid();
const trace = logger.trace({ id: uuid(), name: "Demo trace" });
const prompt =
	"Predict the top 3 largest city by 2050. For each, return the name, the country, the reason why it will on the list, and the estimated population in millions.";
trace.input(prompt);

try {
	const { text: rawOutput } = await generateText({
		model: model,
		prompt: prompt,
		providerOptions: {
			maxim: {
				traceName: "Demo Trace",
				traceId: trace.id,
				spanId: spanId,
			} as MaximVercelProviderMetadata,
		},
	});

	const { object } = await generateObject({
		model: model,
		prompt: "Extract the desired information from this text: \n" + rawOutput,
		schema: z.object({
			name: z.string().describe("the name of the city"),
			country: z.string().describe("the name of the country"),
			reason: z.string().describe("the reason why the city will be one of the largest cities by 2050"),
			estimatedPopulation: z.number(),
		}),
		output: "array",
		providerOptions: {
			maxim: {
				traceId: trace.id,
				spanId: spanId,
			} as MaximVercelProviderMetadata,
		},
	});

	const { text: output } = await generateText({
		model: model,
		prompt: `Format this into a human-readable format: ${JSON.stringify(object)}`,
		providerOptions: {
			maxim: {
				traceId: trace.id,
			} as MaximVercelProviderMetadata,
		},
	});
	trace.end();

	console.log("OpenAI response for demo **trace**", output);
} catch (error) {
	console.error("Error in demo trace", error);
}
```

### Legacy Langchain Integration

For projects still using our separate package [Maxim Langchain Tracer](https://www.npmjs.com/package/@maximai/maxim-js-langchain) (now deprecated in favor of the built-in tracer above), you can use our built-in tracer as is by just replacing the import and installing `@langchain/core`.

## Version changelog

### v6.8.0

- **feat**: Migrated from native HTTP/HTTPS to Axios with comprehensive retry logic
  - **BREAKING INTERNAL**: Replaced native Node.js `http`/`https` modules with `axios` and `axios-retry` for all API calls
  - **RELIABILITY**: Enhanced retry mechanism with exponential backoff (up to 5 attempts) for server errors (5xx) and network issues
  - **NETWORK RESILIENCE**: Automatic retries for common network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND, etc.)
  - **SMART RETRY**: Respects `Retry-After` headers and includes jitter to prevent thundering herd problems
  - **ERROR HANDLING**: Client errors (4xx) are still immediately rejected without retries, preserving API contract
  - **PERFORMANCE**: Improved connection pooling and keep-alive support for better throughput
  - **TIMEOUT**: Enhanced timeout management with configurable per-request timeouts
  - **DEBUGGING**: Better error logging and retry attempt tracking in debug mode
  - **NEW DEPENDENCIES**: Added `axios` and `axios-retry` as direct dependencies

### v6.7.0

- **feat**: Enhanced large log handling with automatic remote storage upload
  - **NEW FEATURE**: Automatic detection of large logs (>900KB) and direct upload to remote storage instead of SDK endpoint
  - **PERFORMANCE**: Significantly improved performance when logging large volumes of data by bypassing SDK payload limits
  - **RELIABILITY**: Added retry mechanism (up to 3 attempts) for failed storage uploads
  - **TRANSPARENCY**: Debug logging for large log upload operations with size and key information
  - **AUTOMATIC**: No code changes required - large logs are automatically detected and handled via storage flow

### v6.6.0

- **feat**: Added Vercel AI SDK integration
  - **NEW EXPORT**: `wrapMaximAISDKModel` - Wrapper function for AI SDK models (available via `@maximai/maxim-js/vercel-ai-sdk`)
  - **NEW TYPE**: `MaximVercelProviderMetadata` - Type for custom metadata in `providerOptions.maxim`
  - Support for all AI SDK generation functions: `generateText`, `streamText`, `generateObject`, `streamObject`
  - Automatic log component tracking with custom metadata support
  - Comprehensive TypeScript support
- **fix**: Prevented LangChain packages from being auto-installed when not needed because they were listed as optional dependencies
  - Moved LangChain dependencies to devDependencies for cleaner installations and exported it via `@maximai/maxim-js/langchain`
  - Improved build process to exclude development dependencies from published package
- **feat**: Enhanced developer experience
  - Added comprehensive JSDoc comments for better IntelliSense support
  - Improved TypeScript type definitions throughout the library
- **fix**: Fixes boolean deployment var comparison issue for both prompt and prompt chain deployments

### v6.5.0

- **⚠️ BREAKING CHANGES**:
  - **`Prompt.messages` type changed**: The `messages` field type has been updated for better type safety
    - **Before**: `{ role: string; content: string | CompletionRequestContent[] }[]`
    - **After**: `(CompletionRequest | ChatCompletionMessage)[]`
    - **Migration**: Update your code to use the new `CompletionRequest` interface which has more specific role types (`"user" | "system" | "tool" | "function"`) instead of generic `string`

    ```typescript
    // Before (v6.4.x and earlier)
    const messages: { role: string; content: string }[] = [{ role: "user", content: "Hello" }];

    // After (v6.5.0+)
    const messages: CompletionRequest[] = [
    	{ role: "user", content: "Hello" }, // role is now type-safe
    ];
    ```

  - **`GenerationConfig.messages` type changed**: For better type safety and tool call support
    - **Before**: `messages: CompletionRequest[]`
    - **After**: `messages: (CompletionRequest | ChatCompletionMessage)[]`
    - **Migration**: Your existing `CompletionRequest[]` arrays will still work, but you can now also pass `ChatCompletionMessage[]` for assistant responses with tool calls
  - **`Generation.addMessages()` method signature changed**:
    - **Before**: `addMessages(messages: CompletionRequest[])`
    - **After**: `addMessages(messages: (CompletionRequest | ChatCompletionMessage)[])`
    - **Migration**: Your existing calls will still work, but you can now also pass assistant messages with tool calls
  - **`MaximLogger.generationAddMessage()` method signature changed**:
    - **Before**: `generationAddMessage(generationId: string, messages: CompletionRequest[])`
    - **After**: `generationAddMessage(generationId: string, messages: (CompletionRequest | ChatCompletionMessage)[])`
    - **Migration**: Your existing calls will still work, but you can now also pass assistant messages with tool calls

- **feat**: Added LangChain integration with `MaximLangchainTracer`
  - Comprehensive tracing support for LangChain and LangGraph applications
  - Automatic detection of 8+ LLM providers (OpenAI, Anthropic, Google, Bedrock, etc.)
  - Support for chains, agents, retrievers, and tool calls
  - Custom metadata and tagging capabilities
  - Added `@langchain/core` as optional dependency
- **feat**: Enhanced prompt and prompt chain execution capabilities
  - **NEW METHOD**: `Prompt.run(input, options?)` - Execute prompts directly from Prompt objects
  - **NEW METHOD**: `PromptChain.run(input, options?)` - Execute prompt chains directly from PromptChain objects
  - Support for image URLs when running prompts via `ImageUrl` type
  - Support for variables in prompt execution
- **feat**: New types and interfaces for improved type safety
  - **NEW TYPE**: `PromptResponse` - Standardized response format for prompt executions
  - **NEW TYPE**: `AgentResponse` - Standardized response format for prompt chain executions
  - **ENHANCED TYPE**: `ChatCompletionMessage` - More specific interface for assistant messages with tool call support
  - **ENHANCED TYPE**: `CompletionRequest` - More specific interface with type-safe roles
  - **NEW TYPE**: `Choice`, `Usage` - Supporting types for response data with token usage
  - **NEW TYPE**: `ImageUrl` - Type for image URL content in prompts (extracted from `CompletionRequestImageUrlContent`)
  - **NEW TYPE**: `AgentCost`, `AgentUsage`, `AgentResponseMeta` - Supporting types for agent responses
- **feat**: Test run improvements with prompt chain support
  - Enhanced test run execution with cost and usage tracking for prompt chains
  - Support for prompt chains alongside existing prompt and workflow support
  - **NEW METHOD**: `TestRunBuilder.withPromptChainVersionId(id, contextToEvaluate?)` - Add prompt chain to test runs
- **feat**: Enhanced exports for better developer experience
  - **NEW EXPORT**: `MaximLangchainTracer` - Main LangChain integration class
  - **NEW EXPORTS**: `ChatCompletionMessage`, `Choice`, `CompletionRequest`, `PromptResponse` - Core types now available for external use
  - Enhanced type safety and IntelliSense support for prompt handling
- **feat**: Standalone package configuration
  - **MIGRATION**: Moved from NX monorepo to standalone package (internal change, no user action needed)
  - Added comprehensive build, test, and lint scripts
  - Updated TypeScript configuration for ES2022 target
  - Added Prettier and ESLint configuration files
  - **NEW EXPORT**: `VariableType` from dataset models
- **deps**: LangChain ecosystem support (all optional)
  - **NEW OPTIONAL**: `@langchain/core` as optional dependency (^0.3.0) - only needed if using `MaximLangchainTracer`

**Migration Guide for v6.5.0**:

1. **If you access `Prompt.messages` directly**: Update your type annotations to use `CompletionRequest | ChatCompletionMessage` types
2. **If you create custom prompt objects**: Ensure your `messages` array uses the new interface structure
3. **If you use `Generation.addMessages()`**: The method now accepts `(CompletionRequest | ChatCompletionMessage)[]` - your existing code will work unchanged
4. **If you use `MaximLogger.generationAddMessage()`**: The method now accepts `(CompletionRequest | ChatCompletionMessage)[]` - your existing code will work unchanged
5. **If you create `GenerationConfig` objects**: The `messages` field now accepts `(CompletionRequest | ChatCompletionMessage)[]` - your existing code will work unchanged
6. **To use LangChain integration**: Install `@langchain/core` and import `MaximLangchainTracer`
7. **No action needed for**: Regular SDK usage through `maxim.logger()`, test runs, or prompt management APIs

**⚠️ Note**: While these are technically breaking changes at the type level, most existing code will continue to work because `CompletionRequest[]` is compatible with `(CompletionRequest | ChatCompletionMessage)[]`. You may only see TypeScript compilation errors if you have strict type checking enabled.

### v6.4.0

- feat: adds `provider` field to the `Prompt` type. This field specifies the LLM provider (e.g., 'openai', 'anthropic', etc.) for the prompt.
- feat: include Langchain integration in the main repository

### v6.3.0

- feat: adds attachments support to `Trace`, `Span`, and `Generation` for file uploads.
  - 3 attachment types are supported: file path, buffer data, and URL
  - has auto-detection of MIME types, file sizes, and names for attachments wherever possible
- fix: refactored message handling for Generations to prevent keeping messages reference but rather duplicates the object to ensure point in time capture.
- fix: ensures proper cleanup of resources

**Adding attachments**

```js
// Add file as attachment
entity.addAttachment({
	id: uuid(),
	type: "file",
	path: "/path/to/file.pdf",
});

// Add buffer data as attachment
const buffer = fs.readFileSync("image.png");
entity.addAttachment({
	id: uuid(),
	type: "fileData",
	data: buffer,
});

// Add URL as attachment
entity.addAttachment({
	id: uuid(),
	type: "url",
	url: "https://example.com/image.jpg",
});
```

### v6.5.0
⚠️ BREAKING CHANGES:

Prompt.messages type changed: The messages field type has been updated for better type safety

Before: { role: string; content: string | CompletionRequestContent[] }[]
After: (CompletionRequest | ChatCompletionMessage)[]
Migration: Update your code to use the new CompletionRequest interface which has more specific role types ("user" | "system" | "tool" | "function") instead of generic string

```js
// Before (v6.4.x and earlier)
const messages: { role: string; content: string }[] = [{ role: "user", content: "Hello" }];

// After (v6.5.0+)
const messages: CompletionRequest[] = [
	{ role: "user", content: "Hello" }, // role is now type-safe
];
```

GenerationConfig.messages type changed: For better type safety and tool call support

Before: messages: CompletionRequest[]
After: messages: (CompletionRequest | ChatCompletionMessage)[]
Migration: Your existing CompletionRequest[] arrays will still work, but you can now also pass ChatCompletionMessage[] for assistant responses with tool calls
Generation.addMessages() method signature changed:

Before: addMessages(messages: CompletionRequest[])
After: addMessages(messages: (CompletionRequest | ChatCompletionMessage)[])
Migration: Your existing calls will still work, but you can now also pass assistant messages with tool calls
MaximLogger.generationAddMessage() method signature changed:

Before: generationAddMessage(generationId: string, messages: CompletionRequest[])
After: generationAddMessage(generationId: string, messages: (CompletionRequest | ChatCompletionMessage)[])
Migration: Your existing calls will still work, but you can now also pass assistant messages with tool calls
feat: Added LangChain integration with MaximLangchainTracer

Comprehensive tracing support for LangChain and LangGraph applications
Automatic detection of 8+ LLM providers (OpenAI, Anthropic, Google, Bedrock, etc.)
Support for chains, agents, retrievers, and tool calls
Custom metadata and tagging capabilities
Added @langchain/core as optional dependency
feat: Enhanced prompt and prompt chain execution capabilities

NEW METHOD: Prompt.run(input, options?) - Execute prompts directly from Prompt objects
NEW METHOD: PromptChain.run(input, options?) - Execute prompt chains directly from PromptChain objects
Support for image URLs when running prompts via ImageUrl type
Support for variables in prompt execution
feat: New types and interfaces for improved type safety

NEW TYPE: PromptResponse - Standardized response format for prompt executions
NEW TYPE: AgentResponse - Standardized response format for prompt chain executions
ENHANCED TYPE: ChatCompletionMessage - More specific interface for assistant messages with tool call support
ENHANCED TYPE: CompletionRequest - More specific interface with type-safe roles
NEW TYPE: Choice, Usage - Supporting types for response data with token usage
NEW TYPE: ImageUrl - Type for image URL content in prompts (extracted from CompletionRequestImageUrlContent)
NEW TYPE: AgentCost, AgentUsage, AgentResponseMeta - Supporting types for agent responses
feat: Test run improvements with prompt chain support

Enhanced test run execution with cost and usage tracking for prompt chains
Support for prompt chains alongside existing prompt and workflow support
NEW METHOD: TestRunBuilder.withPromptChainVersionId(id, contextToEvaluate?) - Add prompt chain to test runs
feat: Enhanced exports for better developer experience

NEW EXPORT: MaximLangchainTracer - Main LangChain integration class
NEW EXPORTS: ChatCompletionMessage, Choice, CompletionRequest, PromptResponse - Core types now available for external use
Enhanced type safety and IntelliSense support for prompt handling
feat: Standalone package configuration

MIGRATION: Moved from NX monorepo to standalone package (internal change, no user action needed)
Added comprehensive build, test, and lint scripts
Updated TypeScript configuration for ES2022 target
Added Prettier and ESLint configuration files
NEW EXPORT: VariableType from dataset models
deps: LangChain ecosystem support (all optional)

NEW OPTIONAL: @langchain/core as optional dependency (^0.3.0) - only needed if using MaximLangchainTracer
Migration Guide for v6.5.0:

If you access Prompt.messages directly: Update your type annotations to use CompletionRequest | ChatCompletionMessage types
If you create custom prompt objects: Ensure your messages array uses the new interface structure
If you use Generation.addMessages(): The method now accepts (CompletionRequest | ChatCompletionMessage)[] - your existing code will work unchanged
If you use MaximLogger.generationAddMessage(): The method now accepts (CompletionRequest | ChatCompletionMessage)[] - your existing code will work unchanged
If you create GenerationConfig objects: The messages field now accepts (CompletionRequest | ChatCompletionMessage)[] - your existing code will work unchanged
To use LangChain integration: Install @langchain/core and import MaximLangchainTracer
No action needed for: Regular SDK usage through maxim.logger(), test runs, or prompt management APIs
⚠️ Note: While these are technically breaking changes at the type level, most existing code will continue to work because CompletionRequest[] is compatible with (CompletionRequest | ChatCompletionMessage)[]. You may only see TypeScript compilation errors if you have strict type checking enabled.

## v6.4.0
- feat: adds provider field to the Prompt type. This field specifies the LLM provider (e.g., 'openai', 'anthropic', etc.) for the prompt.
- feat: include Langchain integration in the main repository

## v6.3.0

- feat: adds attachments support to Trace, Span, and Generation for file uploads.
- 3 attachment types are supported: file path, buffer data, and URL has auto-detection of MIME types, file sizes, and names for attachments wherever possible
- fix: refactored message handling for Generations to prevent keeping messages reference but rather duplicates the object to ensure point in time capture.
- fix: ensures proper cleanup of resources

```js
Adding attachments

// Add file as attachment
entity.addAttachment({
	id: uuid(),
	type: "file",
	path: "/path/to/file.pdf",
});

// Add buffer data as attachment
const buffer = fs.readFileSync("image.png");
entity.addAttachment({
	id: uuid(),
	type: "fileData",
	data: buffer,
});

// Add URL as attachment
entity.addAttachment({
	id: uuid(),
	type: "url",
	url: "https://example.com/image.jpg",
});
```

### v6.2.2

- fix: Added support for OpenAI's `logprobs` output in generation results (`ChatCompletionResult` and `TextCompletionResult`).

### v6.2.1

- fix: Refactored message handling in Generation class to prevent duplicate messages

### v6.2.0

- chore: Adds maximum payload limit to push to the server
- chore: Adds max in-memory size of the queue for pending commit logs. Beyond that limit, writer automatically flushes logs to the server

### v6.1.8

- Feat: Adds new `error` component
- Chore: Adds ID validator for each entity. It will spit out error log or exception based on `raiseExceptions` flag.

### v6.1.7

- Feat: Adds `trace.addToSession` method for attaching trace to a new session

### v6.1.6

- Fix: minor bug fixes around queuing of logs.

### v6.1.5

- Fix: updates create test run api to use v2 api

### v6.1.4

- Fix: Handles marking test run as failed if the test run throws at any point after creating it on the platform.
- Feat: Adds support for `contextToEvaluate` in `withPromptVersionId` and `withWorkflowId` (by passing it as the second parameter) to be able to choose whichever variable or dataset column to use as context to evaluate, as opposed to only having the dataset column as context through the `CONTEXT_TO_EVALUATE` datastructure mapping.

### v6.1.3

- Feat: Adds `createCustomEvaluator` and `createCustomCombinedEvaluatorsFor` for adding custom evaluators to add them to the test runs.
- Feat: Adds `withCustomLogger` to the test run builder chain to have a custom logger that follows the `TestRunLogger` interface.
- Feat: Adds `createDataStructure` function to create a data struture outside the test run builder. This is done to help use the data structure to infer types outside the test run builder.
- Feat: Adds `withWorkflowId` and `withPromptVersionId` to the test run builder chain.

### v6.1.2

- Fix: makes `eventId` mandatory while logging an event.
- Feat: adds `addMetadata` method to all log components for tracking any additional metadata.
- Feat: adds `evaluate` method to `Trace`, `Span`, `Generation` and `Retrieval` classes for agentic (or node level) evaluation.

### v6.1.1

- Feat: Adds support for tool_calls as a separate entity.

### v6.1.0

- Change: Adds a new config parameter `raiseExceptions` to control exceptions thrown by the SDK. Default value is `false`.
- `getPrompt(s)`, `getPromptChain(s)` and `getFolder(s)` could return undefined if `raiseExceptions` is `false`.

### v6.0.4

- Change: Prompt management needs to be enabled via config.
- Chore: On multiple initializations of the SDK, SDK will warn the user. This start throwing exceptions in future releases.

### v6.0.3

- Chore: removed optional dependencies

### v6.0.2

- Feat: Adds a new `logger.flush` method to explicitly flushing logs

### v6.0.1

- Fix: fixes logger cleanup

### v6.0.0

- Feat: Jinja 2.0 variables support

### v5.2.6

- Fix: fixes incorrect message format for openai structured output params

### v5.2.5

- Fix: fixes incorrect mapping of messages for old langchain sdk

### v5.2.4

- Fix: config fixes for static classes

### v5.2.3

- Improvement: Adds AWS lambda support for Maxim SDK.

### v5.2.2

- Fix: There was a critical bug in the implementation of HTTP POST calls where some of the payloads were getting truncated.

### v5.2.1

- Fix: For ending any entity, we make sure endTimestamp is captured from client side. This was not the case earlier in some scenarios.
- Fix: Data payload will always be a valid JSON

### v5.2.0

- Improvement: Adds exponential retries to the API calls to Maxim server.

### v5.1.2

- Improvement: Readme updates.

### v5.1.1

- Improvement: Detailed logs in debug mode

### v5.1.0

- Adds scaffold to support LangchainTracer for Maxim SDK.

### v5.0.3

- Exposes MaximLogger for writing wrappers for different developer SDKs.

### v5.0.2

- Adds more type-safety for generation messages

### v5.0.1

- Adds support input/output for traces

### v5.0.0

- Adds support for node 12+

### V4.0.2

- Fixed a critical bug related to pushing generation results to the Maxim platform
- Improved error handling for network connectivity issues
- Enhanced performance when logging large volumes of data

### V4.0.1

- Adds retrieval updates
- Adds ChatMessage support

### v4.0.0 (Breaking changes)

- Adds prompt chain support
- Adds vision model support for prompts

### v3.0.7

- Adds separate error reporting method for generations

### v3.0.6

- Adds top level methods for easier SDK integration

### v3.0.5

- Fixes logs push error

### v3.0.4

- Minor bug fixes

### v3.0.3

- Updates default base url

### v3.0.2

- Prompt selection algorithm v2

### v3.0.1

- Minor bug fixes

### v3.0.0

- Moves to new base URL
- Adds all new logging support

### v2.1.0

- Adds support for adding dataset entries via SDK.

### v2.0.0

- Folders, Tags and advanced filtering support.
- Add support for customizing default matching algorithm.

### v1.1.0

- Adds realtim sync for prompt deployment.

### v1.0.0

- Adds support for deployment variables and custom fields. [Breaking change from earlier versions.]

### v0.5.0

- Adds support for new SDK apis.

### v0.4.0

- Adds support for custom fields for Prompts.
