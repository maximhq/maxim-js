/**
 * Cache interface for the Maxim SDK.
 *
 * This interface defines the contract for cache implementations used by the Maxim SDK
 * to store and retrieve cache across distributed systems. Implementations can use
 * in-memory storage, Redis, file systems, or any other persistence mechanism.
 *
 * @interface MaximCache
 *
 * @example
 * // Custom Redis-based cache implementation
 * import { createClient } from 'redis';
 *
 * class RedisCacheImplementation implements MaximCache {
 *   private client = createClient();
 *
 *   async getAllKeys(): Promise<string[]> {
 *     return await this.client.keys('*');
 *   }
 *
 *   async get(key: string): Promise<string | null> {
 *     return await this.client.get(key);
 *   }
 *
 *   async set(key: string, value: string): Promise<void> {
 *     await this.client.set(key, value);
 *   }
 *
 *   async delete(key: string): Promise<void> {
 *     await this.client.del(key);
 *   }
 * }
 *
 * @example
 * // Using with Maxim SDK
 * const maxim = new Maxim({
 *   apiKey: 'your-api-key',
 *   cache: new RedisCacheImplementation()
 * });
 */
export interface MaximCache {
	/**
	 * Retrieves all keys currently stored in the cache.
	 *
	 * @returns An array of all cache keys.
	 * @throws {Error} When the cache operation fails or is inaccessible.
	 * @example
	 * const keys = await cache.getAllKeys();
	 * console.log('Cache contains keys:', keys);
	 */
	getAllKeys(): Promise<string[]>;

	/**
	 * Retrieves a value from the cache for the given key.
	 *
	 * @param key - The cache key to retrieve. Must be a non-empty string.
	 * @returns The cached value as a string, or null if the key doesn't exist.
	 * @throws {Error} When the cache operation fails or is inaccessible.
	 * @example
	 * const value = await cache.get('user:123');
	 * if (value !== null) {
	 *   const userData = JSON.parse(value);
	 * }
	 */
	get(key: string): Promise<string | null>;

	/**
	 * Stores a value in the cache with the specified key.
	 *
	 * @param key - The cache key to store under. Must be a non-empty string.
	 * @param value - The string value to cache. Will be stored as-is.
	 * @returns A promise that resolves when the value is successfully stored.
	 * @throws {Error} When the cache operation fails or is inaccessible.
	 * @example
	 * await cache.set('user:123', JSON.stringify({ name: 'John', id: 123 }));
	 */
	set(key: string, value: string): Promise<void>;

	/**
	 * Removes a key and its associated value from the cache.
	 *
	 * @param key - The cache key to delete. Must be a non-empty string.
	 * @returns A promise that resolves when the key is successfully deleted.
	 * @throws {Error} When the cache operation fails or is inaccessible.
	 * @example
	 * await cache.delete('user:123');
	 * // Key 'user:123' and its value are now removed from cache
	 */
	delete(key: string): Promise<void>;
}
