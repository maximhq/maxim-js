import type { AsyncLocalStorage as AsyncLocalStorageType } from "node:async_hooks";

/**
 * Per-invocation collection of in-flight flush promises.
 *
 * The Maxim model wrappers push their background flush promises here (via the
 * flush-strategy helpers in `./utils`) when a Lambda invocation is being held
 * open by {@link withMaximLambdaHandler}. The handler wrapper then awaits them
 * in the window after the response stream closes but before the invocation
 * completes.
 */
export interface MaximFlushStore {
	pending: Promise<unknown>[];
}

type FlushALS = AsyncLocalStorageType<MaximFlushStore>;

// `undefined` = not yet resolved, `null` = unavailable on this runtime.
let flushContext: FlushALS | null | undefined;

/**
 * Lazily instantiates the `AsyncLocalStorage` used to scope flushes to a single
 * Lambda invocation.
 *
 * `node:async_hooks` is loaded defensively so that importing this module on
 * runtimes that lack it (edge, react-native) degrades to "no flush window"
 * rather than throwing at import time.
 */
function getFlushContext(): FlushALS | null {
	if (flushContext !== undefined) {
		return flushContext;
	}
	try {
		const asyncHooks = require("node:async_hooks") as typeof import("node:async_hooks");
		flushContext = new asyncHooks.AsyncLocalStorage<MaximFlushStore>();
	} catch {
		flushContext = null;
	}
	return flushContext;
}

/**
 * Returns the flush store for the current Lambda invocation, if one is active
 * (i.e. the handler is wrapped with {@link withMaximLambdaHandler}). Returns
 * `undefined` everywhere else, so callers fall through to their default flush
 * strategy.
 */
export function getMaximFlushStore(): MaximFlushStore | undefined {
	return getFlushContext()?.getStore();
}

/** Hard ceiling on the post-response flush window, regardless of remaining time. */
const DEFAULT_FLUSH_CAP_MS = 5000;

/** Safety margin kept below the Lambda deadline so the runtime is never killed mid-flush. */
const REMAINING_TIME_BUFFER_MS = 1000;

interface LambdaContextLike {
	getRemainingTimeInMillis?: () => number;
}

/**
 * Derives the flush-window cap for this invocation: the smaller of the fixed
 * ceiling and the remaining Lambda time minus a safety buffer. Reading the
 * remaining time at drain time (after the handler has run) reflects the real
 * budget left, so a slow/failing Maxim API can never push the invocation into
 * a timeout.
 */
function computeFlushCapMs(args: unknown[]): number {
	const ctx = args.find(
		(a): a is LambdaContextLike =>
			typeof a === "object" && a !== null && typeof (a as LambdaContextLike).getRemainingTimeInMillis === "function",
	);
	const remaining = ctx?.getRemainingTimeInMillis?.();
	if (typeof remaining === "number" && Number.isFinite(remaining)) {
		return Math.max(0, Math.min(DEFAULT_FLUSH_CAP_MS, remaining - REMAINING_TIME_BUFFER_MS));
	}
	return DEFAULT_FLUSH_CAP_MS;
}

/**
 * Awaits the invocation's pending flushes, bounded by `capMs`. Anything not
 * settled within the cap is left in the writer's retry queue (deferred, not
 * lost) so the invocation can complete before the Lambda deadline.
 */
async function drainPendingFlushes(store: MaximFlushStore, capMs: number): Promise<void> {
	if (store.pending.length === 0) {
		return;
	}
	if (capMs <= 0) {
		// No budget left — leave the in-flight flushes to the writer's queue.
		return;
	}
	const settled = Promise.allSettled(store.pending).then(() => undefined);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const capReached = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, capMs);
		timer?.unref?.();
	});
	try {
		await Promise.race([settled, capReached]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

/**
 * Wraps an AWS Lambda handler so Maxim can flush telemetry in the window
 * *after* the response stream closes but *before* the invocation completes
 * (and the sandbox freezes).
 *
 * This requires Lambda **response streaming**: the handler must be passed to
 * `awslambda.streamifyResponse(...)` and the Function URL configured with
 * `InvokeMode: RESPONSE_STREAM`. On buffered / API Gateway paths no such window
 * exists physically, and the SDK's default blocking flush remains correct
 * (and costs nothing extra, since the response was always going to wait for the
 * handler to return).
 *
 * The flush window is capped (see `DEFAULT_FLUSH_CAP_MS` and the remaining
 * Lambda time) so a slow or failing Maxim API can never push the invocation
 * into a timeout. Anything not flushed within the cap stays in the writer's
 * retry queue.
 *
 * Safe by construction: if `node:async_hooks` is unavailable the handler is
 * returned unchanged, and the model wrappers fall back to their default flush
 * strategy. If the store cannot be found at flush time (e.g. a library that
 * drops async context), the wrappers likewise fall through to blocking — the
 * failure mode is "no improvement", never "lost logs".
 *
 * @example
 * export const handler = awslambda.streamifyResponse(
 *   withMaximLambdaHandler(async (event, responseStream, context) => {
 *     // existing handler — unchanged
 *   }),
 * );
 *
 * @param handler - The Lambda handler to wrap (async).
 * @returns The wrapped handler with the same signature.
 */
export function withMaximLambdaHandler<H extends (...args: any[]) => Promise<unknown>>(handler: H): H {
	const context = getFlushContext();
	if (!context) {
		// No async_hooks on this runtime — cannot open a window; no-op wrapper.
		return handler;
	}
	return (async (...args: Parameters<H>): Promise<unknown> => {
		const store: MaximFlushStore = { pending: [] };
		return context.run(store, async () => {
			try {
				return await handler(...args);
			} finally {
				// Borrowed post-response window: the client already has the full
				// response; only now do we wait (capped) for telemetry to upload.
				await drainPendingFlushes(store, computeFlushCapMs(args));
			}
		});
	}) as H;
}
