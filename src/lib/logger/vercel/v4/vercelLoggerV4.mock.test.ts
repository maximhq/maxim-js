/**
 * Self-contained tests for the AI SDK v4 (AI SDK 7) wrapper.
 *
 * The wrapper depends only on the `ai-sdk-provider-v4` interface types and a
 * `MaximLogger` — NOT on the `ai` package — so these tests hand-roll a
 * `LanguageModelV4` mock and drive `doGenerate` / `doStream` directly. That
 * keeps them runnable without upgrading the repo's pinned `ai@6` to `ai@7`
 * (the two cannot coexist) and without any API keys or external network.
 *
 * Maxim ingestion is faked with an in-process HTTP server so we can assert
 * both behavior (routing, stream pass-through, result shaping) and log
 * delivery.
 *
 * Run:
 *   npx jest src/lib/logger/vercel/v4/vercelLoggerV4.mock.test.ts --verbose
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type {
	LanguageModelV4,
	LanguageModelV4CallOptions,
	LanguageModelV4GenerateResult,
	LanguageModelV4Prompt,
	LanguageModelV4StreamPart,
	LanguageModelV4Usage,
} from "ai-sdk-provider-v4";
import { Maxim } from "../../../../../index";
import { wrapMaximAISDKModel } from "../../../../../vercel-ai-sdk";
import type { MaximLogger } from "../../logger";
import { MaximAISDKWrapperV4 } from "./wrapperV4";
import { parsePromptMessagesV4 } from "./utils";

jest.setTimeout(30_000);

// ---------------------------------------------------------------------------
// Mock Maxim API server (records POSTs to the log-ingestion endpoint)
// ---------------------------------------------------------------------------

interface MockMaximServer {
	baseUrl: string;
	pushes: string[];
	close: () => Promise<void>;
}

function startMockMaximServer(): Promise<MockMaximServer> {
	const pushes: string[] = [];
	const server = http.createServer((req, res) => {
		const bodyChunks: Buffer[] = [];
		req.on("data", (chunk) => bodyChunks.push(chunk));
		req.on("end", () => {
			const body = Buffer.concat(bodyChunks).toString("utf8");
			const isPushLogs = req.method === "POST" && (req.url ?? "").startsWith("/api/sdk/v3/log");
			if (isPushLogs) {
				pushes.push(body);
				res.writeHead(200, { "Content-Type": "text/plain" });
				res.end("ok");
				return;
			}
			// Repo-existence check and everything else responds instantly
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ data: true }));
		});
	});

	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			resolve({
				baseUrl: `http://127.0.0.1:${port}`,
				pushes,
				close: () =>
					new Promise<void>((res2) => {
						server.close(() => res2());
						server.closeAllConnections?.();
					}),
			});
		});
	});
}

// ---------------------------------------------------------------------------
// Hand-rolled LanguageModelV4 mock
// ---------------------------------------------------------------------------

const MOCK_USAGE: LanguageModelV4Usage = {
	inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 20, text: 20, reasoning: 0 },
};

const STREAM_PARTS: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "txt-1" },
	{ type: "text-delta", id: "txt-1", delta: "Hello " },
	{ type: "text-delta", id: "txt-1", delta: "world" },
	{ type: "text-end", id: "txt-1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: MOCK_USAGE },
];

function makeMockV4Model(overrides: Partial<LanguageModelV4> = {}): LanguageModelV4 {
	return {
		specificationVersion: "v4",
		provider: "openai",
		modelId: "gpt-mock-v4",
		supportedUrls: {},
		async doGenerate(): Promise<LanguageModelV4GenerateResult> {
			return {
				content: [{ type: "text", text: "Hello from the mock v4 model!" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage: MOCK_USAGE,
				warnings: [],
			};
		},
		async doStream() {
			return {
				stream: new ReadableStream<LanguageModelV4StreamPart>({
					start(controller) {
						for (const part of STREAM_PARTS) controller.enqueue(part);
						controller.close();
					},
				}),
			};
		},
		...overrides,
	} as LanguageModelV4;
}

function textPrompt(text: string): LanguageModelV4Prompt {
	return [{ role: "user", content: [{ type: "text", text }] }];
}

async function drainStream(stream: ReadableStream<LanguageModelV4StreamPart>): Promise<LanguageModelV4StreamPart[]> {
	const out: LanguageModelV4StreamPart[] = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		out.push(value);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AI SDK v4 (AI SDK 7) wrapper", () => {
	let mockServer: MockMaximServer;
	let maxim: Maxim;
	let logger: MaximLogger;

	beforeAll(async () => {
		mockServer = await startMockMaximServer();
		maxim = new Maxim({ baseUrl: mockServer.baseUrl, apiKey: "v4-test-key" });
		const l = await maxim.logger({ id: "v4-log-repo", flushIntervalSeconds: 3600 });
		if (!l) throw new Error("Failed to create logger");
		logger = l;
	});

	afterAll(async () => {
		await maxim.cleanup();
		await mockServer.close();
	});

	beforeEach(() => {
		mockServer.pushes.length = 0;
	});

	describe("routing", () => {
		it("routes a specificationVersion 'v4' model to MaximAISDKWrapperV4", () => {
			const wrapped = wrapMaximAISDKModel(makeMockV4Model(), logger);
			expect(wrapped).toBeInstanceOf(MaximAISDKWrapperV4);
			expect(wrapped.specificationVersion).toBe("v4");
			expect(wrapped.modelId).toBe("gpt-mock-v4");
			expect(wrapped.provider).toBe("openai");
		});
	});

	describe("doGenerate", () => {
		it("returns the underlying result unchanged and delivers a log", async () => {
			const wrapped = wrapMaximAISDKModel(makeMockV4Model(), logger);
			const options: LanguageModelV4CallOptions = { prompt: textPrompt("Say hello") };

			const result = await wrapped.doGenerate(options);

			expect(result.content).toEqual([{ type: "text", text: "Hello from the mock v4 model!" }]);
			expect(result.finishReason.unified).toBe("stop");
			await logger.flush();
			expect(mockServer.pushes.length).toBeGreaterThan(0);
		});

		it("surfaces provider errors while still ending the trace", async () => {
			const boom = makeMockV4Model({
				doGenerate: async () => {
					throw new Error("provider exploded");
				},
			});
			const wrapped = wrapMaximAISDKModel(boom, logger);
			await expect(wrapped.doGenerate({ prompt: textPrompt("hi") })).rejects.toThrow("provider exploded");
		});
	});

	describe("doStream", () => {
		it("passes chunks through unmodified, in order, and closes", async () => {
			const wrapped = wrapMaximAISDKModel(makeMockV4Model(), logger);
			const { stream } = await wrapped.doStream({ prompt: textPrompt("Say hello") });

			const received = await drainStream(stream);

			// The wrapper must forward the provider's parts verbatim.
			expect(received).toEqual(STREAM_PARTS);
			const text = received
				.filter((p): p is Extract<LanguageModelV4StreamPart, { type: "text-delta" }> => p.type === "text-delta")
				.map((p) => p.delta)
				.join("");
			expect(text).toBe("Hello world");

			await logger.flush();
			expect(mockServer.pushes.length).toBeGreaterThan(0);
		});
	});

	describe("parsePromptMessagesV4 (v4 file-data tagged union)", () => {
		it("extracts a URL file attachment", () => {
			const prompt: LanguageModelV4Prompt = [
				{
					role: "user",
					content: [
						{ type: "text", text: "look at this" },
						{ type: "file", mediaType: "image/png", data: { type: "url", url: new URL("https://example.com/cat.png") } },
					],
				},
			];
			const { messages, attachments } = parsePromptMessagesV4(prompt);
			expect(attachments).toHaveLength(1);
			expect(attachments[0]).toMatchObject({ type: "url", url: "https://example.com/cat.png", mimeType: "image/png" });
			// Text content is preserved on the message
			expect(messages[0]).toMatchObject({ role: "user" });
		});

		it("extracts inline bytes as a fileData attachment", () => {
			const bytes = new Uint8Array([1, 2, 3, 4]);
			const prompt: LanguageModelV4Prompt = [
				{ role: "user", content: [{ type: "file", mediaType: "application/octet-stream", data: { type: "data", data: bytes } }] },
			];
			const { attachments } = parsePromptMessagesV4(prompt);
			expect(attachments).toHaveLength(1);
			expect(attachments[0]).toMatchObject({ type: "fileData", mimeType: "application/octet-stream" });
			expect((attachments[0] as { data: Buffer }).data).toEqual(Buffer.from(bytes));
		});

		it("decodes a base64 data-URI file into bytes", () => {
			const base64 = Buffer.from("hi").toString("base64");
			const prompt: LanguageModelV4Prompt = [
				{
					role: "user",
					content: [{ type: "file", mediaType: "text/plain", data: { type: "data", data: `data:text/plain;base64,${base64}` } }],
				},
			];
			const { attachments } = parsePromptMessagesV4(prompt);
			expect(attachments).toHaveLength(1);
			expect((attachments[0] as { data: Buffer }).data.toString("utf8")).toBe("hi");
		});

		it("surfaces an inline text document as message text, not an attachment", () => {
			const prompt: LanguageModelV4Prompt = [
				{ role: "user", content: [{ type: "file", mediaType: "text/plain", data: { type: "text", text: "inline doc" } }] },
			];
			const { messages, attachments } = parsePromptMessagesV4(prompt);
			expect(attachments).toHaveLength(0);
			expect(JSON.stringify(messages[0])).toContain("inline doc");
		});
	});
});
