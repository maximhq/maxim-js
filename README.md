# Maxim SDK

<div style="display: flex; justify-content: center; align-items: center;margin-bottom:20px;">
<img src="https://cdn.getmaxim.ai/third-party/sdk.png">
</div>

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

## Version changelog

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
