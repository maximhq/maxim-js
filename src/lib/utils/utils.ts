import crypto, { randomBytes } from "crypto";
import os from "os";

export function generateUniqueId(): string {
	const timestamp = Date.now().toString(36); // Convert timestamp to base 36 string
	const hostname = os.hostname(); // Get the hostname
	const randomBytes = crypto.randomBytes(4).toString("hex"); // Generate 4 random bytes and convert to hex string
	return `${timestamp}-${hostname}-${randomBytes}`;
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
	const randomPart = randomBytes(4).toString("hex");

	// Get hostname or machine fingerprint (reduced to avoid full hostname)
	const fingerprint = crypto.createHash("md5").update(os.hostname()).digest("hex").slice(0, 2);

	// Combine parts to create CUID
	const prefix = "c";
	const cuid = [prefix, timestamp, counter, fingerprint, randomPart].join("");
	return cuid;
}
