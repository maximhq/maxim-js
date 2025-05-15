export interface MaximCache {
	getAllKeys(): Promise<string[]>;
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}
