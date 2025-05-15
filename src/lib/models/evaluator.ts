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
