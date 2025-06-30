import { MaximCache } from "./cache";

/**
 * In-memory implementation of the MaximCache interface for the Maxim SDK.
 *
 * This class provides a simple, fast cache implementation using JavaScript's Map
 * for storing key-value pairs in memory. Data is not persisted across application
 * restarts and is limited by available memory.
 *
 * @class MaximInMemoryCache
 * @implements {MaximCache}
 * @example
 * import { MaximInMemoryCache } from '@maximai/maxim-js';
 *
 * const cache = new MaximInMemoryCache();
 * await cache.set('user:123', JSON.stringify({ name: 'John', id: 123 }));
 * const user = await cache.get('user:123');
 * console.log(JSON.parse(user)); // { name: 'John', id: 123 }
 *
 * @example
 * // Using with Maxim SDK
 * import { Maxim, MaximInMemoryCache } from '@maximai/maxim-js';
 *
 * const maxim = new Maxim({
 *   apiKey: 'your-api-key',
 *   cache: new MaximInMemoryCache()
 * });
 */
export class MaximInMemoryCache implements MaximCache {
	private cache: Map<string, string> = new Map();

	/**
	 * Retrieves all keys currently stored in the in-memory cache.
	 *
	 * @returns An array of all cache keys
	 * @example
	 * const cache = new MaximInMemoryCache();
	 * await cache.set('key1', 'value1');
	 * await cache.set('key2', 'value2');
	 * const keys = await cache.getAllKeys(); // ['key1', 'key2']
	 */
	getAllKeys(): Promise<string[]> {
		return Promise.resolve(Array.from(this.cache.keys()));
	}

	/**
	 * Retrieves a value from the in-memory cache by key.
	 *
	 * @param key - The cache key to retrieve. Must be a non-empty string.
	 * @returns The cached value string, or null if the key doesn't exist
	 * @example
	 * const cache = new MaximInMemoryCache();
	 * await cache.set('user:123', '{"name":"John"}');
	 * const value = await cache.get('user:123'); // '{"name":"John"}'
	 * const missing = await cache.get('nonexistent'); // null
	 */
	async get(key: string): Promise<string | null> {
		return Promise.resolve(this.cache.get(key) ?? null);
	}

	/**
	 * Stores a value in the in-memory cache with the specified key.
	 *
	 * @param key - The cache key to store under. Must be a non-empty string.
	 * @param value - The value to cache. Will be stored as-is in memory.
	 * @returns A promise that resolves when the value is successfully stored
	 * @example
	 * const cache = new MaximInMemoryCache();
	 * await cache.set('config', JSON.stringify({ theme: 'dark' }));
	 * // Value is now stored in memory
	 */
	async set(key: string, value: string): Promise<void> {
		this.cache.set(key, value);
		return Promise.resolve();
	}

	/**
	 * Removes a key and its associated value from the in-memory cache.
	 *
	 * @param key - The cache key to delete. Must be a non-empty string.
	 * @returns A promise that resolves when the key is successfully deleted
	 * @example
	 * const cache = new MaximInMemoryCache();
	 * await cache.set('temp:data', 'some value');
	 * await cache.delete('temp:data');
	 * const result = await cache.get('temp:data'); // null
	 */
	async delete(key: string): Promise<void> {
		this.cache.delete(key);
		return Promise.resolve();
	}
}
