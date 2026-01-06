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

/**
 * The output object passed to variableMapping functions.
 * This matches the YieldedOutput type from testRun but is defined here to avoid circular imports.
 */
export type VariableMappingInput = {
	data: string;
	retrievedContextToEvaluate?: string | string[];
	messages?: unknown[];
	meta?: {
		usage?:
			| {
					promptTokens: number;
					completionTokens: number;
					totalTokens: number;
					latency?: number;
			  }
			| {
					latency: number;
			  };
		cost?: {
			input: number;
			output: number;
			total: number;
		};
	};
	/** Allow additional properties for custom evaluator-specific outputs */
	[key: string]: unknown;
};

export type VariableMappingFunction = (
	run: VariableMappingInput,
	dataset?: Record<string, any>,
	version?: { id?: string; [key: string]: any },
) => string | undefined;

/**
 * A function that transforms the output into a string for evaluation.
 * This allows each evaluator to define how to extract/transform the output it should evaluate on.
 * @param run The result of the test run, containing output, metadata, and traces.
 * @param dataset The dataset entry corresponding to this run.
 * @param version The configuration version used for this run (e.g. prompt version).
 * @returns The extracted string value to be evaluated.
 */
/**
 * A dictionary of variable mapping functions, keyed by the variable name.
 */
export type VariableMapping = Record<string, VariableMappingFunction>;

export type LocalEvaluatorType<T extends DataStructure | undefined = undefined> = {
	name: string;
	evaluationFunction: (result: Record<string, any>, data: Data<T>) => Promise<LocalEvaluatorReturnType> | LocalEvaluatorReturnType;
	passFailCriteria: PassFailCriteriaType;
	/**
	 * Optional map of functions to extract values from the output object.
	 * The keys of this map will differ from the keys of the result object passed to the evaluation function.
	 * If not provided, `{ output: output.data, contextToEvaluate: output.retrievedContextToEvaluate }` will be used.
	 */
	variableMapping?: VariableMapping;
};

export type CombinedLocalEvaluatorType<T extends DataStructure | undefined, U extends Record<string, PassFailCriteriaType>> = {
	names: ReadonlyArray<keyof U>;
	evaluationFunction: (
		result: Record<string, any>,
		data: Data<T>,
	) => Promise<Record<keyof U, LocalEvaluatorReturnType>> | Record<keyof U, LocalEvaluatorReturnType>;
	passFailCriteria: U;
	/**
	 * Optional map of functions to extract values from the output object.
	 * The keys of this map will differ from the keys of the result object passed to the evaluation function.
	 * If not provided, `{ output: output.data, contextToEvaluate: output.retrievedContextToEvaluate }` will be used.
	 */
	variableMapping?: VariableMapping;
};

/**
 * A platform evaluator (identified by name) with an optional variable mapping.
 * Use this when you need to transform the output for a platform evaluator.
 *
 * @example
 * .withEvaluators(
 *   "Accuracy", // Simple platform evaluator
 *   {
 *     name: "Bias",
 *     variableMapping: {
 *       output: (output) => output["bias-output"]
 *     }
 *   }, // Platform evaluator with mapping
 * )
 */
export type PlatformEvaluator = {
	name: string;
	variableMapping?: VariableMapping;
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
	/** The output string that was used for this evaluator's evaluation (may be mangled) */
	output?: string;
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
