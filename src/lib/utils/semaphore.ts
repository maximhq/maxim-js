import crypto from "crypto";

export class Semaphore {
	private static semaphores: Map<string, Semaphore> = new Map();
	private key: string;
	private maxLocks: number;
	private currentLocks: number;
	private queue: (() => void)[];

	constructor(key: string, maxLocks: number) {
		this.key = Semaphore.hash(key);
		this.maxLocks = maxLocks;
		this.currentLocks = 0;
		this.queue = [];

		// Store the semaphore instance in the static map
		Semaphore.semaphores.set(this.key, this);
	}

	private static hash(key: string): string {
		return crypto.createHash("md5").update(key).digest("hex");
	}

	async acquire(): Promise<void> {
		// If there are available locks, acquire immediately
		if (this.currentLocks < this.maxLocks) {
			this.currentLocks++;
			return Promise.resolve();
		}

		// Otherwise, add to the queue and wait
		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	release(): void {
		if (this.currentLocks > 0) {
			this.currentLocks--;

			// If there are waiting processes in the queue, resolve the next one
			if (this.queue.length > 0) {
				const nextResolver = this.queue.shift();
				if (nextResolver) {
					this.currentLocks++;
					nextResolver();
				}
			}
		}
	}

	// Static method to get or create a Semaphore instance
	static get(key: string, maxLocks: number): Semaphore {
		const hashedKey = Semaphore.hash(key);
		if (!Semaphore.semaphores.has(hashedKey)) {
			return new Semaphore(key, maxLocks);
		}
		return Semaphore.semaphores.get(hashedKey)!;
	}
}
