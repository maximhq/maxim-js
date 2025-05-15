export class Queue<T> {
	private storage: Array<T> = new Array<T>();
	private maxSize: number;

	constructor(maxSize: number = 10000) {
		this.maxSize = maxSize;
	}

	public enqueue(item: T): void {
		if (this.storage.length >= this.maxSize) {
			// remove the oldest item
			this.storage.shift();
		}
		this.storage.push(item);
	}

	public enqueueAll(items: Array<T>): void {
		if (this.storage.length + items.length > this.maxSize) {
			// remove the oldest items
			this.storage.splice(0, items.length - this.maxSize);
		}
		this.storage.push(...items);
	}

	public dequeue(): T | undefined {
		return this.storage.shift();
	}

	public dequeueAll(): Array<T> {
		const items = this.storage;
		this.storage = new Array<T>();
		return items;
	}

	public get size(): number {
		return this.storage.length;
	}
}
