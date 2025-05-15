import type { DataStructure } from "../models/dataset";
import type { CombinedLocalEvaluatorType, LocalEvaluatorType, PassFailCriteriaType } from "../models/evaluator";
import { generateCuid } from "../utils/utils";

export function buildErrorMessage(error: unknown, isCause?: boolean): string {
	let message = "";

	if (!isCause) message += "\n";

	if (error instanceof Error) {
		if (!isCause) {
			message += `❌ ${error.message}:\n`;
		} else {
			message += `\t\t=> ${error.message}\n`;
		}

		if (!isCause && error.stack) {
			message += `\tStack: ${error.stack}\n`;
		}

		if (error.cause) {
			if (!isCause) {
				message += `\tCaused by:\n`;
			}
			message += buildErrorMessage(error.cause, true);
		}
	} else {
		message += `❌ ${JSON.stringify(error)}\n`;
	}

	if (!isCause) message += "\n";

	return message;
}

export function calculatePollingInterval(timeoutMinutes: number, isAIEvaluatorInUse: boolean = false): number {
	const points: [number, number][] = [
		[10, 5],
		[15, 5],
		[30, 10],
		[60, 15],
		[120, 30],
		[1440, 120],
	];

	// Find the two closest points
	let lowerPoint = points[0];
	let upperPoint = points[points.length - 1];

	for (let i = 0; i < points.length - 1; i++) {
		if (timeoutMinutes >= points[i][0] && timeoutMinutes <= points[i + 1][0]) {
			lowerPoint = points[i];
			upperPoint = points[i + 1];
			break;
		}
	}

	// Interpolate between the two points using a power function
	const [x1, y1] = lowerPoint;
	const [x2, y2] = upperPoint;

	if (x1 === x2) return y1; // Handle edge case

	const t = (timeoutMinutes - x1) / (x2 - x1);
	const p = 2; // Adjust this value to change the curve's shape
	const interpolatedValue = y1 + (y2 - y1) * Math.pow(t, p);

	// Round to nearest integer and clamp between 5 and 120
	return Math.min(Math.max(Math.round(interpolatedValue), isAIEvaluatorInUse ? 15 : 5), 120);
}

export function getLocalEvaluatorNameToIdAndPassFailCriteriaMap<T extends DataStructure | undefined>(
	evaluators: (LocalEvaluatorType<T> | CombinedLocalEvaluatorType<T, Record<string, PassFailCriteriaType>> | string)[],
) {
	const allEvalNames = new Set(
		evaluators
			.filter((e) => typeof e !== "string")
			.map((evaluator) => ("names" in evaluator ? evaluator.names : [evaluator.name]))
			.flat(),
	);
	const allPassFailCriteria = evaluators
		.filter((e) => typeof e !== "string")
		.reduce(
			(acc, evaluator) => {
				if ("names" in evaluator) {
					return Object.assign(acc, evaluator.passFailCriteria);
				} else {
					acc[evaluator.name] = evaluator.passFailCriteria;
					return acc;
				}
			},
			{} as Record<string, PassFailCriteriaType>,
		);

	const nameToIdAndPassFailCriteriaMap = new Map<string, { id: string; passFailCriteria: PassFailCriteriaType }>();

	allEvalNames.forEach((evalName) => {
		nameToIdAndPassFailCriteriaMap.set(evalName, { id: generateCuid(), passFailCriteria: allPassFailCriteria[evalName] });
	});

	return nameToIdAndPassFailCriteriaMap;
}

type StatusData = Record<"running" | "queued" | "completed" | "failed" | "stopped" | "total", number>;

export const cliAsciiColors = {
	reset: "\x1b[0m",
	// Text colors
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	// Bright variants
	brightRed: "\x1b[91m",
	brightGreen: "\x1b[92m",
	brightYellow: "\x1b[93m",
	brightBlue: "\x1b[94m",
	// Styles
	bold: "\x1b[1m",
	dim: "\x1b[2m",
};

export function createStatusTable(data: StatusData): string {
	// Status emojis and colors mapping
	const statusConfig: Record<keyof StatusData, { emoji: string; color: string }> = {
		running: { emoji: "🟢", color: cliAsciiColors.brightGreen },
		queued: { emoji: "⏳", color: cliAsciiColors.brightYellow },
		completed: { emoji: "✅", color: cliAsciiColors.green },
		failed: { emoji: "❌", color: cliAsciiColors.brightRed },
		stopped: { emoji: "✋", color: cliAsciiColors.dim },
		total: { emoji: "📊", color: cliAsciiColors.brightBlue },
	};

	const maxKeyLength = Math.max(...Object.keys(data).map((key) => key.length));
	const NUMBER_WIDTH = 5; // Fixed width for numbers (up to 99999)

	// Create table border characters
	const borderChars = {
		topLeft: "╭",
		topRight: "╮",
		bottomLeft: "╰",
		bottomRight: "╯",
		horizontal: "─",
		vertical: "│",
	};

	// Calculate total width including fixed number width
	const contentWidth = maxKeyLength + NUMBER_WIDTH + 7; // 7 for emoji (2) + spaces (5)
	const totalWidth = contentWidth; // Add 2 for the vertical borders

	// Create the table header and footer
	const header = `${borderChars.topLeft}${borderChars.horizontal.repeat(totalWidth)}${borderChars.topRight}`;
	const footer = `${borderChars.bottomLeft}${borderChars.horizontal.repeat(totalWidth)}${borderChars.bottomRight}`;

	// Create table rows with fixed-width number column
	const rows = (Object.entries(data) as [keyof StatusData, StatusData[keyof StatusData]][])
		.map(([key, value]) => {
			const config = statusConfig[key] || { emoji: "•", color: cliAsciiColors.dim };
			const paddedKey = key.padEnd(maxKeyLength);
			const paddedValue = value.toString().padStart(NUMBER_WIDTH);

			return `${borderChars.vertical} ${config.emoji}  ${config.color}${cliAsciiColors.bold}${paddedKey}${cliAsciiColors.reset} ${cliAsciiColors.brightBlue}${paddedValue}${cliAsciiColors.reset} ${borderChars.vertical}`;
		})
		.join("\n");

	return `${header}\n${rows}\n${footer}`;
}
