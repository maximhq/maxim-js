import type { DataStructure } from "../models/dataset";
import type { CombinedLocalEvaluatorType, LocalEvaluatorType, PassFailCriteriaType } from "../models/evaluator";

export function createCustomEvaluator<T extends DataStructure | undefined = undefined>(
	name: string,
	evaluationFunction: LocalEvaluatorType<T>["evaluationFunction"],
	passFailCriteria: LocalEvaluatorType<T>["passFailCriteria"],
): LocalEvaluatorType<T> {
	if (!passFailCriteria) {
		throw new Error(`Error while creating evaluator ${name}: passFailCriteria is required`);
	}
	sanitizePassFailCriteria(name, passFailCriteria);

	return {
		name,
		evaluationFunction,
		passFailCriteria,
	};
}

export function createCustomCombinedEvaluatorsFor<const U extends string[]>(...names: U) {
	return {
		build: function <T extends DataStructure | undefined = undefined>(
			evaluationFunction: CombinedLocalEvaluatorType<T, Record<U[number], PassFailCriteriaType>>["evaluationFunction"],
			passFailCriteria: CombinedLocalEvaluatorType<T, Record<U[number], PassFailCriteriaType>>["passFailCriteria"],
		): CombinedLocalEvaluatorType<T, Record<U[number], PassFailCriteriaType>> {
			if (!passFailCriteria) {
				throw new Error(`Error while creating combined evaluator with evaluators ${names.join(", ")}: passFailCriteria is required`);
			}

			const missingPassFailCriteriaNames = Object.keys(passFailCriteria).filter((evaluatorName) => {
				if (!names.includes(evaluatorName)) {
					return true;
				}
				return false;
			});

			if (missingPassFailCriteriaNames.length > 0) {
				throw new Error(
					`Error while creating combined evaluator with evaluators ${names.join(", ")}: criteria has evaluator names ${missingPassFailCriteriaNames.join(
						", ",
					)} which are not in the names array`,
				);
			}

			const invalidPassFailCriteriaErrors: string[] = [];
			Object.entries(passFailCriteria).forEach(([evaluatorName, criteria]) => {
				try {
					sanitizePassFailCriteria(evaluatorName, criteria as PassFailCriteriaType);
				} catch (err) {
					invalidPassFailCriteriaErrors.push(err instanceof Error ? err.message : JSON.stringify(err));
				}
			});
			if (invalidPassFailCriteriaErrors.length > 0) {
				throw new Error(
					`Error while creating combined Evaluator with names ${names} due to invalid pass fail criteria: ${invalidPassFailCriteriaErrors.join(", ")}`,
				);
			}

			return {
				names,
				evaluationFunction,
				passFailCriteria,
			};
		},
	};
}

function sanitizePassFailCriteria(name: string, passFailCriteria: PassFailCriteriaType) {
	const allOperators = [">=", "<=", "<", ">", "=", "!="];
	const booleanOperators = ["=", "!="];
	switch (typeof passFailCriteria.onEachEntry.value) {
		case "number":
			if (!allOperators.includes(passFailCriteria.onEachEntry.scoreShouldBe)) {
				throw new Error(
					`Error While Creating Evaluator ${name}: Invalid operator for scoreShouldBe, only accepts ` + allOperators.join(", "),
				);
			}
			break;
		case "boolean":
			if (!booleanOperators.includes(passFailCriteria.onEachEntry.scoreShouldBe)) {
				throw new Error(
					`Error While Creating Evaluator ${name}: Invalid operator for scoreShouldBe, only accepts ` + booleanOperators.join(", "),
				);
			}
			break;
		default:
			throw new Error(`Error While Creating Evaluator ${name}: Invalid type for onEachEntry.value, only accepts number or boolean`);
	}
	if (typeof passFailCriteria.forTestrunOverall.value === "number") {
		if (!allOperators.includes(passFailCriteria.forTestrunOverall.overallShouldBe)) {
			throw new Error(
				`Error While Creating Evaluator ${name}: Invalid operator for overallShouldBe, only accepts ` + allOperators.join(", "),
			);
		}
		if (passFailCriteria.forTestrunOverall.for !== "average" && passFailCriteria.forTestrunOverall.for !== "percentageOfPassedResults") {
			throw new Error(
				`Error While Creating Evaluator ${name}: Invalid value for \`for\` in forTestrunOverall, only accepts "average" or "percentageOfPassedResults"`,
			);
		}
	} else {
		throw new Error(`Error While Creating Evaluator ${name}: Invalid type for forTestrunOverall.value, only accepts number`);
	}
}
