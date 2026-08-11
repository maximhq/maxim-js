/**
 * E2E harness: Expo server (`expo/server`) flush strategy in the AI SDK wrapper.
 *
 * Verifies that when the wrapper runs inside an Expo server request, the log
 * flush is handed to Expo's `deferTask` — which runs after the response is sent
 * and keeps the request handler alive until it settles — so the model stream
 * closes promptly (no user-facing latency) while logs are still delivered.
 *
 * `expo/server` is an optional peer that isn't installed in this repo, so it is
 * mocked virtually here. The mock lives in this dedicated file (not the shared
 * stream-close-latency suite) because mocking `expo/server` file-wide would
 * route every flush through `deferTask` and break the Vercel/Lambda cases.
 *
 * Run:
 *   npx jest src/lib/tests/vercel/expoDeferTask.e2e.test.ts --verbose
 */
import { streamText, type LanguageModel } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { LanguageModelV3, LanguageModelV3StreamPart, LanguageModelV3Usage } from "ai-sdk-provider-v3";

// ---------------------------------------------------------------------------
// Mock `expo/server` (virtual — the package isn't a dependency of this repo).
// `deferTask` simulates Expo holding the request open past the response: it
// invokes the task immediately and records the promise so the test can await
// the post-response window (mirrors how the real runtime keeps the handler
// alive until the deferred task settles).
// ---------------------------------------------------------------------------
const mockDeferredTasks: Promise<unknown>[] = [];
jest.mock(
	"expo/server",
	() => ({
		deferTask: (fn: () => void | Promise<unknown>) => {
			const result = fn();
			if (result && typeof (result as Promise<unknown>).then === "function") {
				mockDeferredTasks.push(result as Promise<unknown>);
			}
		},
	}),
	{ virtual: true },
);

// Import AFTER jest.mock so the wrapper's lazy `require("expo/server")` resolves
// to the mock above.
import { Maxim } from "../../../../index";
import { wrapMaximAISDKModel } from "../../../../vercel-ai-sdk";
import type { MaximLogger } from "../../logger/logger";

jest.setTimeout(120_000);

const FLUSH_DELAY_MS = Number(process.env["MOCK_FLUSH_DELAY_MS"] ?? 3000);
// A wrapped stream should close within this budget after the last token.
const CLOSE_BUDGET_MS = Math.min(1000, FLUSH_DELAY_MS / 2);

// ---------------------------------------------------------------------------
// Mock Maxim API server
// ---------------------------------------------------------------------------

interface RecordedPush {
	receivedAt: number;
	respondedAt: number;
	body: string;
}

interface MockMaximServer {
	baseUrl: string;
	pushes: RecordedPush[];
	close: () => Promise<void>;
}

function startMockMaximServer(pushLogsDelayMs: number): Promise<MockMaximServer> {
	const pushes: RecordedPush[] = [];

	const server = http.createServer((req, res) => {
		const bodyChunks: Buffer[] = [];
		req.on("data", (chunk) => bodyChunks.push(chunk));
		req.on("end", () => {
			const body = Buffer.concat(bodyChunks).toString("utf8");
			const isPushLogs = req.method === "POST" && (req.url ?? "").startsWith("/api/sdk/v3/log");

			if (isPushLogs) {
				const receivedAt = performance.now();
				setTimeout(() => {
					pushes.push({ receivedAt, respondedAt: performance.now(), body });
					res.writeHead(200, { "Content-Type": "text/plain" });
					res.end("ok");
				}, pushLogsDelayMs);
				return;
			}

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
// Mock provider model
// ---------------------------------------------------------------------------

const MOCK_USAGE: LanguageModelV3Usage = {
	inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 20, text: 20, reasoning: 0 },
};

function makeStreamingMockModel(): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: async () => ({
			stream: simulateReadableStream<LanguageModelV3StreamPart>({
				chunks: [
					{ type: "stream-start", warnings: [] },
					{ type: "text-start", id: "txt-1" },
					...Array.from(
						{ length: 20 },
						(_, i): LanguageModelV3StreamPart => ({ type: "text-delta", id: "txt-1", delta: `token-${i} ` }),
					),
					{ type: "text-end", id: "txt-1" },
					{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: MOCK_USAGE },
				],
				chunkDelayInMs: 5,
			}),
		}),
	}) as unknown as LanguageModelV3;
}

// ---------------------------------------------------------------------------
// Measurement helper
// ---------------------------------------------------------------------------

interface StreamTiming {
	lastDeltaToClose: number;
	total: number;
	text: string;
}

async function consumeAndMeasure(model: LanguageModel): Promise<StreamTiming> {
	const t0 = performance.now();
	let tLastDelta = t0;
	let text = "";

	const result = streamText({ model, prompt: "Say hello" });
	for await (const part of result.fullStream) {
		if (part.type === "text-delta") {
			text += part.text;
			tLastDelta = performance.now();
		}
	}
	const tClosed = performance.now();

	return { lastDeltaToClose: tClosed - tLastDelta, total: tClosed - t0, text };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("AI SDK wrapper: Expo server deferTask flush strategy (e2e)", () => {
	let mockServer: MockMaximServer;
	let maxim: Maxim;
	let logger: MaximLogger;

	beforeAll(async () => {
		mockServer = await startMockMaximServer(FLUSH_DELAY_MS);
		maxim = new Maxim({ baseUrl: mockServer.baseUrl, apiKey: "e2e-test-key" });
		const l = await maxim.logger({ id: "e2e-log-repo", flushIntervalSeconds: 3600 });
		if (!l) throw new Error("Failed to create logger");
		logger = l;
	});

	afterAll(async () => {
		await maxim.cleanup();
		await mockServer.close();
	});

	beforeEach(() => {
		mockServer.pushes.length = 0;
		mockDeferredTasks.length = 0;
	});

	it("Expo server: flush is handed to deferTask, stream closes promptly, logs delivered", async () => {
		const wrapped = wrapMaximAISDKModel(makeStreamingMockModel(), logger);
		const timing = await consumeAndMeasure(wrapped as unknown as LanguageModel);
		console.log(
			`[expo deferTask] lastDelta→close: ${timing.lastDeltaToClose.toFixed(1)}ms, ` +
				`deferred tasks: ${mockDeferredTasks.length} (flush delay ${FLUSH_DELAY_MS}ms)`,
		);

		// Stream must close without waiting for the flush.
		expect(timing.text.length).toBeGreaterThan(0);
		expect(timing.lastDeltaToClose).toBeLessThan(CLOSE_BUDGET_MS);
		// The flush must be registered with deferTask (not blocking, not fire-and-forget).
		expect(mockDeferredTasks.length).toBeGreaterThan(0);

		// Simulate the Expo runtime honoring deferTask before completing the request.
		await Promise.all(mockDeferredTasks);
		expect(mockServer.pushes.length).toBeGreaterThan(0);
		expect(mockServer.pushes[0].body.length).toBeGreaterThan(0);
	});
});
