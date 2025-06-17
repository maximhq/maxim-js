import type { Data, DataStructure } from "../models/dataset";

type LocalEvaluatorReturnType = {
	score: number | boolean | string;
	reasoning?: string;
};

export type OperatorType = ">=" | "<" | "<=" | ">" | "=" | "!=";
export type PassFailCriteriaType = {
	onEachEntry:
		| {
				scoreShouldBe: "=" | "!=";
				value: boolean;
		  }
		| {
				scoreShouldBe: OperatorType;
				value: number;
		  };
	forTestrunOverall: { overallShouldBe: OperatorType; value: number; for: "average" | "percentageOfPassedResults" };
};

export type LocalEvaluatorType<T extends DataStructure | undefined = undefined> = {
	name: string;
	evaluationFunction: (
		result: { output: string; contextToEvaluate?: string | string[] },
		data: Data<T>,
	) => Promise<LocalEvaluatorReturnType> | LocalEvaluatorReturnType;
	passFailCriteria: PassFailCriteriaType;
};

export type CombinedLocalEvaluatorType<T extends DataStructure | undefined, U extends Record<string, PassFailCriteriaType>> = {
	names: (keyof U)[];
	evaluationFunction: (
		result: { output: string; contextToEvaluate?: string | string[] },
		data: Data<T>,
	) => Promise<Record<keyof U, LocalEvaluatorReturnType>> | Record<keyof U, LocalEvaluatorReturnType>;
	passFailCriteria: U;
};

/**
 * Result object containing the outcome of a local evaluator execution.
 *
 * Represents the complete evaluation result from running a local evaluator
 * on a single test run entry, including the score, reasoning, evaluator name,
 * and the pass/fail criteria used for assessment.
 *
 * @property result - The evaluation result containing score and optional reasoning
 * @property name - The name of the evaluator that produced this result
 * @property passFailCriteria - The criteria used to determine pass/fail status
 * @example
 * // Example result from a custom evaluator
 * const evaluationResult: LocalEvaluationResult = {
 *   result: {
 *     score: 0.85,
 *     reasoning: "Response demonstrates good accuracy with minor factual errors"
 *   },
 *   name: "accuracy-checker",
 *   passFailCriteria: {
 *     onEachEntry: {
 *       scoreShouldBe: ">=",
 *       value: 0.7
 *     },
 *     forTestrunOverall: {
 *       overallShouldBe: ">=",
 *       value: 80,
 *       for: "percentageOfPassedResults"
 *     }
 *   }
 * };
 *
 * @example
 * // Boolean evaluation result
 * const booleanResult: LocalEvaluationResult = {
 *   result: {
 *     score: true,
 *     reasoning: "Output contains required keywords"
 *   },
 *   name: "keyword-validator",
 *   passFailCriteria: {
 *     onEachEntry: {
 *       scoreShouldBe: "=",
 *       value: true
 *     },
 *     forTestrunOverall: {
 *       overallShouldBe: ">=",
 *       value: 90,
 *       for: "percentageOfPassedResults"
 *     }
 *   }
 * };
 */
export type LocalEvaluationResult = {
	result: LocalEvaluatorReturnType;
	name: string;
	passFailCriteria: PassFailCriteriaType;
};

export type HumanEvaluationConfig = {
	emails: string[];
	instructions?: string;
};

export type EvaluatorType = "Human" | "AI" | "Programmatic" | "Statistical" | "API" | "Local";

export type MaximAPIEvaluatorFetchResponse =
	| {
			data: {
				id: string;
				name: string;
				type: EvaluatorType;
				builtin: boolean;
				reversed: boolean | undefined;
				config: unknown;
			};
	  }
	| {
			error: {
				message: string;
			};
	  };
