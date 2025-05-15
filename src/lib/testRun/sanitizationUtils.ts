import type { DataStructure } from "../models/dataset";
import type { CombinedLocalEvaluatorType, LocalEvaluatorType, PassFailCriteriaType } from "../models/evaluator";
import type { TestRunConfig } from "../models/testRun";
import { CSVFile } from "../utils/csvParser";

export function sanitizeData<U extends DataStructure | undefined>(dataToSanitize: TestRunConfig<U>["data"], againstDataStructure: U): void {
	if (dataToSanitize) {
		if (againstDataStructure && typeof dataToSanitize !== "string") {
			if (dataToSanitize instanceof CSVFile || typeof dataToSanitize === "function") {
				// do nothing as constructor already checks for the validity and existence of the file in case of CSVFile
				// and for function, we sanitize it while running the test run
			} else {
				dataToSanitize.forEach((entry) => {
					for (const [key, value] of Object.entries(entry)) {
						if (againstDataStructure[key] === "INPUT") {
							if (typeof value !== "string")
								throw new Error(`Input column "${key}" has a data entry which is not a string`, {
									cause: JSON.stringify({ dataEntry: entry }, null, 2),
								});
						} else if (againstDataStructure[key] === "EXPECTED_OUTPUT") {
							if (typeof value !== "string")
								throw new Error(`Expected output column "${key}" has a data entry which is not a string`, {
									cause: JSON.stringify({ dataEntry: entry }, null, 2),
								});
						} else if (againstDataStructure[key] === "CONTEXT_TO_EVALUATE") {
							if (typeof value !== "string" && (!Array.isArray(value) || value.find((v) => typeof v !== "string")))
								throw new Error(`Context to evaluate column "${key}" has a data entry which is not a string or an array`, {
									cause: JSON.stringify({ dataEntry: entry }, null, 2),
								});
						} else if (againstDataStructure[key] === "VARIABLE") {
							if (typeof value !== "string" && (!Array.isArray(value) || value.find((v) => typeof v !== "string")))
								throw new Error(`Variable column "${key}" has a data entry which is not a string or an array`, {
									cause: JSON.stringify({ dataEntry: entry }, null, 2),
								});
						} else if (againstDataStructure[key] === "NULLABLE_VARIABLE") {
							if (
								typeof value !== "string" &&
								value !== undefined &&
								value !== null &&
								(!Array.isArray(value) || value.find((v) => typeof v !== "string"))
							)
								throw new Error(`Nullable variable column "${key}" has a data entry which is not null, a string or an array`, {
									cause: JSON.stringify({ dataEntry: entry }, null, 2),
								});
						} else {
							throw new Error(`Unknown column type "${againstDataStructure[key]}" for column "${key}"`, {
								cause: JSON.stringify({ dataStructure: againstDataStructure, dataEntry: entry }, null, 2),
							});
						}
					}
				});
			}
		} else if (typeof dataToSanitize !== "string") {
			throw new Error("Data structure is not provided and data argument is not a datasetId(string)", {
				cause: JSON.stringify({ data: dataToSanitize }, null, 2),
			});
		}
	}
}

export function sanitizeEvaluators<T extends DataStructure | undefined>(
	evaluators: (LocalEvaluatorType<T> | CombinedLocalEvaluatorType<T, Record<string, PassFailCriteriaType>> | string)[],
): void {
	const namesEncountered = new Set<string>();
	for (const evaluator of evaluators) {
		if (typeof evaluator !== "string" && "names" in evaluator) {
			for (const name of evaluator.names) {
				if (namesEncountered.has(name)) {
					throw new Error(`Multiple evaluators with the same name "${name}" found`, {
						cause: JSON.stringify(
							{ allEvaluatorNames: evaluators.map((e) => (typeof e === "string" ? [e] : "names" in e ? e.names : [e.name])).flat() },
							null,
							2,
						),
					});
				}
				namesEncountered.add(name);
			}
		} else {
			if (namesEncountered.has(typeof evaluator === "string" ? evaluator : evaluator.name)) {
				throw new Error(`Multiple evaluators with the same name "${typeof evaluator === "string" ? evaluator : evaluator.name}" found`, {
					cause: JSON.stringify(
						{ allEvaluatorNames: evaluators.map((e) => (typeof e === "string" ? [e] : "names" in e ? e.names : [e.name])).flat() },
						null,
						2,
					),
				});
			}
			namesEncountered.add(typeof evaluator === "string" ? evaluator : evaluator.name);
		}
	}
}
