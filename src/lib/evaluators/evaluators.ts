import type { DataStructure } from "../models/dataset";
import type { CombinedLocalEvaluatorType, LocalEvaluatorType, PassFailCriteriaType } from "../models/evaluator";

/**
 * Creates a custom evaluator for local evaluation of test run outputs.
 *
 * Local evaluators run client-side during test runs to score each executed row (with output and retrieved context).
 * They must define both an evaluation function and pass/fail criteria to determine success.
 *
 * @template T - The data structure type for the evaluator, extending DataStructure or undefined
 * @param name - Unique name for the evaluator. Must be unique within a test run.
 * @param evaluationFunction - Function that scores outputs
 * @param passFailCriteria - Criteria defining pass/fail thresholds
 * @returns A configured local evaluator ready for use in test runs
 * @throws {Error} When passFailCriteria is null, undefined, or invalid
 * @example
 * import { createCustomEvaluator, createDataStructure } from '@maximai/maxim-js';
 *
 * const dataStructure = createDataStructure({
 *   input: "INPUT",
 *   expectedOutput: "EXPECTED_OUTPUT"
 * });
 *
 * const lengthEvaluator = createCustomEvaluator<typeof dataStructure>(
 *   "response-length",
 *   (result, data) => {
 *     const wordCount = result.output.split(' ').length;
 *     return {
 *       score: wordCount,
 *       reasoning: `Response contains ${wordCount} words`
 *     };
 *   },
 *   {
 *     onEachEntry: {
 *       scoreShouldBe: ">=",
 *       value: 10
 *     },
 *     forTestrunOverall: {
 *       overallShouldBe: ">=",
 *       value: 80,
 *       for: "percentageOfPassedResults"
 *     }
 *   }
 * );
 *
 * @example
 * // Boolean evaluator example
 * const containsKeywordEvaluator = createCustomEvaluator<typeof dataStructure>(
 *   "keyword-checker",
 *   (result, data) => ({
 *     score: result.output.toLowerCase().includes("important"),
 *     reasoning: result.output.includes("important") ? "Contains keyword" : "Missing keyword"
 *   }),
 *   {
 *     onEachEntry: {
 *       scoreShouldBe: "=",
 *       value: true
 *     },
 *     forTestrunOverall: {
 *       overallShouldBe: ">=",
 *       value: 75,
 *       for: "percentageOfPassedResults"
 *     }
 *   }
 * );
 */
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

/**
 * Creates a builder for combined evaluators that can output multiple evaluator scores under the same evaluation function.
 *
 * Combined evaluators allow a single evaluation function to return multiple named scores,
 * useful when one analysis can produce several metrics. Each named score must have
 * corresponding pass/fail criteria.
 *
 * @template U - String literal array type containing evaluator names
 * @param names - Array of evaluator names that will be returned by the evaluation function
 * @returns Builder object with a `build` method to create the combined evaluator
 * @example
 * import { createCustomCombinedEvaluatorsFor, createDataStructure } from '@maximai/maxim-js';
 *
 * const dataStructure = createDataStructure({
 *   input: "INPUT",
 *   expectedOutput: "EXPECTED_OUTPUT"
 * });
 *
 * const qualityEvaluator = createCustomCombinedEvaluatorsFor("accuracy", "relevance", "fluency")
 *   .build<typeof dataStructure>(
 *     (result, data) => {
 *       // Single function returns multiple scores
 *       const analysis = analyzeText(result.output);
 *       return {
 *         accuracy: { score: analysis.factualScore, reasoning: "Fact-checked against sources" },
 *         relevance: { score: analysis.topicScore, reasoning: "Relevance to user query" },
 *         fluency: { score: analysis.grammarScore, reasoning: "Grammar and readability" }
 *       };
 *     },
 *     {
 *       accuracy: {
 *         onEachEntry: { scoreShouldBe: ">=", value: 0.8 },
 *         forTestrunOverall: { overallShouldBe: ">=", value: 85, for: "average" }
 *       },
 *       relevance: {
 *         onEachEntry: { scoreShouldBe: ">=", value: 0.7 },
 *         forTestrunOverall: { overallShouldBe: ">=", value: 80, for: "average" }
 *       },
 *       fluency: {
 *         onEachEntry: { scoreShouldBe: ">=", value: 0.9 },
 *         forTestrunOverall: { overallShouldBe: ">=", value: 90, for: "percentageOfPassedResults" }
 *       }
 *     }
 *   );
 *
 * // Usage in a test run
 * maxim.createTestRun("quality-test", "workspace-id")
 *   .withEvaluators(qualityEvaluator)
 *   .run();
 */
export function createCustomCombinedEvaluatorsFor<const U extends string[]>(...names: U) {
	return {
		/**
		 * Builds the combined evaluator with evaluation function and pass/fail criteria.
		 *
		 * @template T - The data structure type for the evaluator
		 * @param evaluationFunction - Function returning multiple named scores
		 * @param passFailCriteria - Criteria for each named evaluator
		 * @returns The configured combined evaluator
		 * @throws {Error} When passFailCriteria is missing or contains invalid criteria
		 * @throws {Error} When passFailCriteria contains evaluator names not in the names array
		 */
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
