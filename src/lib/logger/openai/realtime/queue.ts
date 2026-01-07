/**
 * AsyncQueue - Ensures handlers are processed sequentially to prevent race conditions.
 * Each queued task is executed only after the previous one completes.
 */
export class AsyncQueue {
	private queue: Array<() => Promise<void>> = [];
	private processing = false;

	/**
	 * Enqueue a task to be executed sequentially.
	 * @param task - An async function to be executed
	 */
	enqueue(task: () => Promise<void>): void {
		this.queue.push(task);
		this.processQueue();
	}

	/**
	 * Process the queue sequentially.
	 */
	private async processQueue(): Promise<void> {
		if (this.processing) {
			return;
		}

		this.processing = true;

		while (this.queue.length > 0) {
			const task = this.queue.shift();
			if (task) {
				try {
					await task();
				} catch (e) {
					console.warn(`[MaximSDK][AsyncQueue] Error processing task: ${e}`);
				}
			}
		}

		this.processing = false;
	}

	/**
	 * Check if the queue is currently empty and not processing.
	 */
	get isIdle(): boolean {
		return !this.processing && this.queue.length === 0;
	}

	/**
	 * Get the current queue length.
	 */
	get length(): number {
		return this.queue.length;
	}
}
