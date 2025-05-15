import { Semaphore } from "./semaphore";

export class Mutex {
	private semaphore: Semaphore;
	private static mutexes: Map<string, Mutex> = new Map();

	/**
	 * Creates a new Mutex instance with a given key
	 * @param key - Unique identifier for the mutex
	 */
	private constructor(key: string) {
		// Create a semaphore with maxLocks = 1 to implement mutex behavior
		this.semaphore = Semaphore.get(key, 1);
	}

	/**
	 * Acquires the lock. If the lock is already held, waits until it's released
	 * @returns Promise that resolves when the lock is acquired
	 */
	async lock(): Promise<void> {
		await this.semaphore.acquire();
	}

	/**
	 * Releases the held lock
	 */
	release(): void {
		this.semaphore.release();
	}

	/**
	 * Gets or creates a Mutex instance for the given key
	 * @param key - Unique identifier for the mutex
	 * @returns Mutex instance
	 */
	static get(key: string): Mutex {
		if (!Mutex.mutexes.has(key)) {
			Mutex.mutexes.set(key, new Mutex(key));
		}
		return Mutex.mutexes.get(key)!;
	}

	/**
	 * Executes a critical section with automatic lock handling
	 * @param key - Unique identifier for the mutex
	 * @param criticalSection - Async function to execute within the mutex
	 * @returns Promise that resolves with the result of the critical section
	 */
	static async withLock<T>(key: string, criticalSection: () => Promise<T>): Promise<T> {
		const mutex = Mutex.get(key);
		await mutex.lock();
		try {
			return await criticalSection();
		} finally {
			mutex.release();
		}
	}

	async withLock<T>(criticalSection: () => Promise<T>): Promise<T> {
		await this.lock();
		try {
			return await criticalSection();
		} finally {
			this.release();
		}
	}
}
