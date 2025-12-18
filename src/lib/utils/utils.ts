import { platform } from "../platform";
import { getRandomHex } from "./secureRandom";

export function generateUniqueId(): string {
	const timestamp = Date.now().toString(36); // Convert timestamp to base 36 string
	const hostname = platform.crypto.hostname(); // Get the hostname
	const randomPart = getRandomHex(8); // Generate 8 hex chars (4 bytes)
	return `${timestamp}-${hostname}-${randomPart}`;
}

export const getAllKeysByValue = <T extends object, V extends T[keyof T]>(obj: T, value: V): (keyof T)[] => {
	return Object.keys(obj).filter((key) => obj[key as keyof T] === value) as (keyof T)[];
};

export type ExtractAPIDataType<T> = T extends { data: infer D } ? D : never;

/**
 * Generates a collision-resistant unique identifier (CUID)
 * Format: c<timestamp><counter><fingerprint><random>
 * @returns A unique identifier string
 */
export function generateCuid(): string {
	// Current timestamp
	const timestamp = Date.now().toString(36);

	// Process-specific counter to improve uniqueness
	const counter = Math.floor(Math.random() * 1000)
		.toString(36)
		.padStart(2, "0");

	// Generate cryptographically secure random bytes
	const randomPart = getRandomHex(8); // 4 bytes as hex

	// Get hostname or machine fingerprint (reduced to avoid full hostname)
	const fingerprint = platform.crypto.createHash("md5").update(platform.crypto.hostname()).digest("hex").slice(0, 2);

	// Combine parts to create CUID
	const prefix = "c";
	const cuid = [prefix, timestamp, counter, fingerprint, randomPart].join("");
	return cuid;
}

/**
 * Replaces all the variables with their values.
 * If no values is provided, the variable will not be replaced.
 *
 * @example
 * ```ts
 * replaceVariables("Hello {{name}}", { name: "John" }); // "Hello John"
 * ```
 * @param template The template string to replace variables in.
 * @param variables The variables to replace.
 * @returns String with all variables replaced.
 */
export function replaceVariables(template: string, variables: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] ?? match);
}
