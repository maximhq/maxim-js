/**
 * E2E harness: stream-close latency vs. log delivery in the AI SDK wrapper.
 *
 * Reproduces the customer report: with `wrapMaximAISDKModel`, the wrapped
 * model stream stays open after the provider finishes because the wrapper
 * awaits `logger.flush()` (an HTTP upload to the Maxim API) before calling
 * `controller.close()`. `streamText` only emits finish / ends the UI message
 * stream once the model stream closes, so the chat UI stays in "streaming"
 * state for the whole flush duration.
 *
 * Fully self-contained — no API keys, no external network:
 *   - Provider:   MockLanguageModelV3 (deterministic token stream)
 *   - Maxim API:  in-process HTTP server with configurable artificial latency
 *
 * Run:
 *   npx jest src/lib/tests/vercel/streamCloseLatency.e2e.test.ts --verbose
 *
 * Knobs:
 *   MOCK_FLUSH_DELAY_MS  simulated Maxim API latency per pushLogs call (default 3000)
 *
 * Expected state:
 *   - BEFORE the fix: "closes promptly", "generateText", and "waitUntil" tests FAIL
 *     (close gap ~= MOCK_FLUSH_DELAY_MS), "delivery" tests pass.
 *   - AFTER the fix: all tests pass (close gap ~ms, logs still delivered).
 */
import { generateText, streamText, type LanguageModel } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { LanguageModelV3, LanguageModelV3StreamPart, LanguageModelV3Usage } from "ai-sdk-provider-v3";
import { Maxim } from "../../../../index";
import { withMaximLambdaHandler, wrapMaximAISDKModel } from "../../../../vercel-ai-sdk";
import type { MaximLogger } from "../../logger/logger";

jest.setTimeout(120_000);

const FLUSH_DELAY_MS = Number(process.env["MOCK_FLUSH_DELAY_MS"] ?? 3000);
// A wrapped stream should close within this budget after the last token.
// Pre-fix, the close gap is >= FLUSH_DELAY_MS, so this cleanly separates the two.
const CLOSE_BUDGET_MS = Math.min(1000, FLUSH_DELAY_MS / 2);

const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

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
				// Simulate a slow Maxim ingestion endpoint / bad network conditions
				setTimeout(() => {
					pushes.push({ receivedAt, respondedAt: performance.now(), body });
					res.writeHead(200, { "Content-Type": "text/plain" });
					res.end("ok");
				}, pushLogsDelayMs);
				return;
			}

			// Everything else (repo-existence check, etc.) responds instantly
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
						// Don't let in-flight sockets hold the server open
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

function makeGenerateMockModel(): LanguageModelV3 {
	return new MockLanguageModelV3({
		doGenerate: async () => ({
			content: [{ type: "text", text: "Hello from the mock model!" }],
			finishReason: { unified: "stop", raw: "stop" },
			usage: MOCK_USAGE,
			warnings: [],
		}),
	}) as unknown as LanguageModelV3;
}

// ---------------------------------------------------------------------------
// Measurement helpers
// ---------------------------------------------------------------------------

interface StreamTiming {
	/** ms between the last text-delta part and stream close (loop exit) */
	lastDeltaToClose: number;
	/** ms between the finish part and stream close (loop exit) */
	finishToClose: number;
	/** total wall time of the stream consumption */
	total: number;
	text: string;
}

async function consumeAndMeasure(model: LanguageModel): Promise<StreamTiming> {
	const t0 = performance.now();
	let tLastDelta = t0;
	let tFinishPart = t0;
	let text = "";

	const result = streamText({ model, prompt: "Say hello" });
	for await (const part of result.fullStream) {
		if (part.type === "text-delta") {
			text += part.text;
			tLastDelta = performance.now();
		}
		if (part.type === "finish") {
			tFinishPart = performance.now();
		}
	}
	// The for-await loop only exits once the underlying stream CLOSES —
	// this is the moment `streamText` unblocks the UI message stream.
	const tClosed = performance.now();

	return {
		lastDeltaToClose: tClosed - tLastDelta,
		finishToClose: tClosed - tFinishPart,
		total: tClosed - t0,
		text,
	};
}

async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
		}
		await new Promise((r) => setTimeout(r, 50));
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AI SDK wrapper: stream-close latency vs. log delivery (e2e)", () => {
	let mockServer: MockMaximServer;
	let maxim: Maxim;
	let logger: MaximLogger;

	beforeAll(async () => {
		mockServer = await startMockMaximServer(FLUSH_DELAY_MS);
		maxim = new Maxim({
			baseUrl: mockServer.baseUrl,
			apiKey: "e2e-test-key",
		});
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
	});

	it("baseline: raw (unwrapped) mock model closes immediately after finish", async () => {
		const timing = await consumeAndMeasure(makeStreamingMockModel() as unknown as LanguageModel);
		console.log(
			`[baseline raw] finish→close: ${timing.finishToClose.toFixed(1)}ms, ` +
				`lastDelta→close: ${timing.lastDeltaToClose.toFixed(1)}ms, total: ${timing.total.toFixed(1)}ms`,
		);
		expect(timing.text.length).toBeGreaterThan(0);
		expect(timing.lastDeltaToClose).toBeLessThan(CLOSE_BUDGET_MS);
	});

	it("wrapped model stream closes promptly after finish (customer-reported bug)", async () => {
		const wrapped = wrapMaximAISDKModel(makeStreamingMockModel(), logger);
		const timing = await consumeAndMeasure(wrapped as unknown as LanguageModel);
		console.log(
			`[wrapped] finish→close: ${timing.finishToClose.toFixed(1)}ms, ` +
				`lastDelta→close: ${timing.lastDeltaToClose.toFixed(1)}ms, total: ${timing.total.toFixed(1)}ms ` +
				`(mock Maxim API latency: ${FLUSH_DELAY_MS}ms)`,
		);
		expect(timing.text.length).toBeGreaterThan(0);
		// PRE-FIX: this fails — close is delayed by ~FLUSH_DELAY_MS because the
		// wrapper awaits logger.flush() before controller.close().
		expect(timing.lastDeltaToClose).toBeLessThan(CLOSE_BUDGET_MS);
	});

	it("wrapped model still delivers logs to the Maxim API after streaming", async () => {
		const wrapped = wrapMaximAISDKModel(makeStreamingMockModel(), logger);
		await consumeAndMeasure(wrapped as unknown as LanguageModel);
		const tClosed = performance.now();

		// Logs must arrive regardless of whether the flush is blocking (pre-fix)
		// or backgrounded (post-fix).
		await waitFor(() => mockServer.pushes.length > 0, FLUSH_DELAY_MS + 10_000, "pushLogs to reach mock Maxim API");
		const arrival = mockServer.pushes[0].respondedAt - tClosed;
		console.log(`[delivery] pushLogs completed ${arrival.toFixed(1)}ms after stream close; payload bytes: ${mockServer.pushes[0].body.length}`);
		expect(mockServer.pushes[0].body.length).toBeGreaterThan(0);
	});

	it("wrapped generateText (doGenerate) returns without blocking on flush", async () => {
		const wrapped = wrapMaximAISDKModel(makeGenerateMockModel(), logger);
		const t0 = performance.now();
		const result = await generateText({ model: wrapped as unknown as LanguageModel, prompt: "Say hello" });
		const wallTime = performance.now() - t0;
		console.log(`[generateText] wall time: ${wallTime.toFixed(1)}ms (mock Maxim API latency: ${FLUSH_DELAY_MS}ms)`);
		expect(result.text.length).toBeGreaterThan(0);
		// PRE-FIX: this fails — doGenerate's finally awaits logger.flush().
		expect(wallTime).toBeLessThan(CLOSE_BUDGET_MS);

		// ...but delivery must still happen in the background.
		await waitFor(() => mockServer.pushes.length > 0, FLUSH_DELAY_MS + 10_000, "pushLogs to reach mock Maxim API");
	});

	it("Vercel environment: flush is handed to waitUntil, stream closes promptly, logs delivered", async () => {
		const captured: Promise<unknown>[] = [];
		(globalThis as Record<PropertyKey, unknown>)[VERCEL_REQUEST_CONTEXT as unknown as string] = {
			get: () => ({
				waitUntil: (p: Promise<unknown>) => {
					captured.push(p);
				},
			}),
		};

		try {
			const wrapped = wrapMaximAISDKModel(makeStreamingMockModel(), logger);
			const timing = await consumeAndMeasure(wrapped as unknown as LanguageModel);
			console.log(
				`[waitUntil] finish→close: ${timing.finishToClose.toFixed(1)}ms, ` +
					`lastDelta→close: ${timing.lastDeltaToClose.toFixed(1)}ms, waitUntil promises: ${captured.length}`,
			);

			// Stream must close without waiting for the flush
			expect(timing.lastDeltaToClose).toBeLessThan(CLOSE_BUDGET_MS);
			// PRE-FIX: fails — the wrapper never registers the flush with waitUntil.
			expect(captured.length).toBeGreaterThan(0);

			// Simulate the serverless runtime honoring waitUntil before freezing
			await Promise.all(captured);
			expect(mockServer.pushes.length).toBeGreaterThan(0);
		} finally {
			delete (globalThis as Record<PropertyKey, unknown>)[VERCEL_REQUEST_CONTEXT as unknown as string];
		}
	});

	it("bare AWS Lambda (no waitUntil): flush completes BEFORE stream close to survive sandbox freeze", async () => {
		process.env["AWS_LAMBDA_FUNCTION_NAME"] = "e2e-test-fn";
		try {
			const wrapped = wrapMaximAISDKModel(makeStreamingMockModel(), logger);
			const timing = await consumeAndMeasure(wrapped as unknown as LanguageModel);
			console.log(
				`[lambda] lastDelta→close: ${timing.lastDeltaToClose.toFixed(1)}ms, pushes at close: ${mockServer.pushes.length}`,
			);
			// On bare Lambda blocking is intentional — delivery must already be
			// complete by the time the stream closes (sandbox may freeze after).
			expect(mockServer.pushes.length).toBeGreaterThan(0);
			expect(timing.lastDeltaToClose).toBeGreaterThanOrEqual(FLUSH_DELAY_MS * 0.9);
		} finally {
			delete process.env["AWS_LAMBDA_FUNCTION_NAME"];
		}
	});

	it("withMaximLambdaHandler: stream closes promptly, flush drained in the post-response window", async () => {
		// Set the Lambda env so we also prove the ALS flush store takes precedence
		// over the plain Lambda-blocking branch.
		process.env["AWS_LAMBDA_FUNCTION_NAME"] = "e2e-test-fn";
		try {
			const wrapped = wrapMaximAISDKModel(makeStreamingMockModel(), logger);
			let timing!: StreamTiming;
			// Generous remaining time → cap = min(5s, remaining - 1s) does not bite.
			const ctx = { getRemainingTimeInMillis: () => 60_000 };
			const handler = withMaximLambdaHandler(async (_event: unknown, _responseStream: unknown, _ctx: unknown) => {
				timing = await consumeAndMeasure(wrapped as unknown as LanguageModel);
				return timing;
			});

			const t0 = performance.now();
			await handler({}, {}, ctx);
			const handlerWall = performance.now() - t0;

			console.log(
				`[withMaximLambdaHandler] lastDelta→close: ${timing.lastDeltaToClose.toFixed(1)}ms, ` +
					`handler wall: ${handlerWall.toFixed(1)}ms, pushes: ${mockServer.pushes.length} (flush delay ${FLUSH_DELAY_MS}ms)`,
			);

			// Stream closes promptly — the ALS store branch closes before flushing,
			// unlike the plain Lambda-blocking branch.
			expect(timing.lastDeltaToClose).toBeLessThan(CLOSE_BUDGET_MS);
			// ...but the handler does not resolve until the flush has drained, so the
			// sandbox will not freeze before delivery.
			expect(mockServer.pushes.length).toBeGreaterThan(0);
			expect(handlerWall).toBeGreaterThanOrEqual(FLUSH_DELAY_MS * 0.9);
		} finally {
			delete process.env["AWS_LAMBDA_FUNCTION_NAME"];
		}
	});

	it("withMaximLambdaHandler: flush window is capped by remaining Lambda time (never eats the timeout)", async () => {
		process.env["AWS_LAMBDA_FUNCTION_NAME"] = "e2e-test-fn";
		try {
			const wrapped = wrapMaximAISDKModel(makeStreamingMockModel(), logger);
			const handler = withMaximLambdaHandler(async (_event: unknown, _responseStream: unknown, _ctx: unknown) => {
				await consumeAndMeasure(wrapped as unknown as LanguageModel);
			});
			// Remaining time forces cap = max(0, min(5000, 1200 - 1000)) = 200ms,
			// well below the 3000ms mock flush — the drain must give up at the cap.
			const ctx = { getRemainingTimeInMillis: () => 1200 };

			const t0 = performance.now();
			await handler({}, {}, ctx);
			const handlerWall = performance.now() - t0;

			console.log(`[withMaximLambdaHandler cap] handler wall: ${handlerWall.toFixed(1)}ms (flush delay ${FLUSH_DELAY_MS}ms)`);

			// The drain returns near the cap rather than waiting the full flush, so a
			// slow/failing Maxim API can never push the invocation past its deadline.
			expect(handlerWall).toBeLessThan(FLUSH_DELAY_MS * 0.9);
		} finally {
			delete process.env["AWS_LAMBDA_FUNCTION_NAME"];
		}
	});
});
