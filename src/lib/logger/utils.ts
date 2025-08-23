export function uniqueId(): string {
	return crypto.randomUUID();
}

export function makeObjectSerializable(obj: unknown): unknown {
	// Handle null or undefined
	if (obj === null || obj === undefined) {
		return null;
	}

	// Handle primitive types
	if (typeof obj !== "object") {
		// Handle BigInt explicitly
		if (typeof obj === "bigint") {
			return obj.toString();
		}

		// Handle Symbol explicitly
		if (typeof obj === "symbol") {
			return {
				type: "symbol",
				symbolDescription: obj.description,
				symbolString: obj.toString(),
			};
		}

		// Handle function explicitly
		if (typeof obj === "function") {
			if ("name" in obj || "toString" in obj) {
				return {
					type: "function",
					functionName: "name" in obj ? obj.name : undefined,
					functionString: "toString" in obj ? obj.toString() : undefined,
				};
			}
			return undefined;
		}

		return obj;
	}

	// Handle Date objects
	if (obj instanceof Date) {
		return obj.toISOString();
	}

	// Handle arrays
	if (Array.isArray(obj)) {
		return obj.map((item) => makeObjectSerializable(item));
	}

	// Handle regular expressions
	if (obj instanceof RegExp) {
		return obj.toString();
	}

	// Handle Maps and Sets
	if (obj instanceof Map) {
		return Object.fromEntries(Array.from(obj.entries()).map(([key, value]) => [key, makeObjectSerializable(value)]));
	}
	if (obj instanceof Set) {
		return Array.from(obj).map((item) => makeObjectSerializable(item));
	}

	// Handle Errors
	if (obj instanceof Error) {
		return {
			type: "error",
			errorName: obj.name,
			errorMessage: obj.message,
			errorStack: obj.stack,
			errorCause: obj.cause ? makeObjectSerializable(obj.cause) : undefined,
		};
	}

	// Handle plain objects
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		result[key] = makeObjectSerializable(value);
	}

	return result;
}
