import type { DataStructure } from "../models/dataset";

/**
 * Creates and validates a data structure definition for test run.
 *
 * Data structures define the schema and column types for datasets used in test runs
 * and evaluations within. This function ensures the structure is valid and returns
 * it for use within test runs.
 *
 * @template T - The data structure type, extending the type DataStructure or undefined
 * @param dataStructure - The data structure definition to create and validate
 * @returns The validated data structure, unchanged if valid
 * @throws {Error} When the data structure contains multiple INPUT, EXPECTED_OUTPUT, or CONTEXT_TO_EVALUATE columns
 * @example
 * import { createDataStructure } from '@maximai/maxim-js';
 *
 * const dataStructure = createDataStructure({
 *   userInput: "INPUT",
 *   expectedResponse: "EXPECTED_OUTPUT",
 *   context: "CONTEXT_TO_EVALUATE",
 *   metadata: "VARIABLE"
 * });
 */
export const createDataStructure = <T extends DataStructure | undefined = undefined>(dataStructure: T) => {
	sanitizeDataStructure(dataStructure);
	return dataStructure;
};

export function sanitizeDataStructure(dataStructure: DataStructure | undefined): void {
	let encounteredInput = false;
	let encounteredExpectedOutput = false;
	let encounteredContextToEvaluate = false;
	if (dataStructure) {
		for (const value of Object.values(dataStructure)) {
			if (value === "INPUT") {
				if (encounteredInput)
					throw new Error("Data structure contains more than one input", { cause: JSON.stringify({ dataStructure }, null, 2) });
				else encounteredInput = true;
			} else if (value === "EXPECTED_OUTPUT") {
				if (encounteredExpectedOutput)
					throw new Error("Data structure contains more than one expectedOutput", { cause: JSON.stringify({ dataStructure }, null, 2) });
				else encounteredExpectedOutput = true;
			} else if (value === "CONTEXT_TO_EVALUATE") {
				if (encounteredContextToEvaluate)
					throw new Error("Data structure contains more than one contextToEvaluate", { cause: JSON.stringify({ dataStructure }, null, 2) });
				else encounteredContextToEvaluate = true;
			}
		}
	}
}

export function validateDataStructure(dataStructure: DataStructure, againstDataStructure: DataStructure) {
	const dataStructureKeys = Object.keys(dataStructure);
	const againstDataStructureKeys = Object.keys(againstDataStructure);
	for (const key of dataStructureKeys) {
		if (!againstDataStructureKeys.includes(key)) {
			throw new Error(`The provided data structure contains key "${key}" which is not present in the dataset on the platform`, {
				cause: JSON.stringify(
					{ providedDataStructureKeys: dataStructureKeys, platformDataStructureKeys: againstDataStructureKeys },
					null,
					2,
				),
			});
		}
	}
}
