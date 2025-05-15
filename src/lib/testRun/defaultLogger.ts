import { Data, DataStructure } from "../models/dataset";
import { LocalEvaluationResult } from "../models/evaluator";
import type { TestRunLogger, YieldedOutput } from "../models/testRun";
import { cliAsciiColors } from "./utils";

export class DefaultLogger<T extends DataStructure | undefined> implements TestRunLogger<T> {
	constructor() {}

	info(message: string) {
		console.log(cliAsciiColors.blue + "🪵 " + message + cliAsciiColors.reset + "\n");
	}

	error(message: string) {
		console.error(cliAsciiColors.red + message + cliAsciiColors.reset + "\n");
	}

	processed(message: string, data: { datasetEntry: Data<T>; output?: YieldedOutput; evaluationResults?: LocalEvaluationResult[] }) {
		console.log(cliAsciiColors.cyan + "✅ " + message + cliAsciiColors.reset + "\n");
	}
}
