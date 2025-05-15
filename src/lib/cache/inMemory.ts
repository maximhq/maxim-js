import { MaximCache } from "./cache";

export class MaximInMemoryCache implements MaximCache {
	private cache: Map<string, string> = new Map();

	getAllKeys(): Promise<string[]> {
		return Promise.resolve(Array.from(this.cache.keys()));
	}

	get(key: string): Promise<string | null> {
		return Promise.resolve(this.cache.get(key) || null);
	}
	set(key: string, value: string): Promise<void> {
		this.cache.set(key, value);
		return Promise.resolve();
	}

	delete(key: string): Promise<void> {
		this.cache.delete(key);
		return Promise.resolve();
	}
}
