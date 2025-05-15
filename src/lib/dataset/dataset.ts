import type { DataStructure } from "../models/dataset";

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
