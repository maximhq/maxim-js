class ExpiringKeyValueStore<T> {
	private store: Map<string, [T, number]>;

	constructor() {
		this.store = new Map();
	}

	set(key: string, value: T, expirySeconds: number): void {
		const expiryTime = Date.now() + expirySeconds * 1000;
		this.store.set(key, [value, expiryTime]);
		this.evictExpired();
	}

	get(key: string): T | null {
		const entry = this.store.get(key);
		if (entry) {
			const [value, expiryTime] = entry;
			if (Date.now() < expiryTime) {
				return value;
			} else {
				this.store.delete(key);
			}
		}
		return null;
	}

	delete(key: string): void {
		this.store.delete(key);
	}

	private evictExpired(): void {
		const currentTime = Date.now();
		for (const [key, [, expiryTime]] of this.store) {
			if (currentTime >= expiryTime) {
				this.store.delete(key);
			}
		}
	}
}

export default ExpiringKeyValueStore;
