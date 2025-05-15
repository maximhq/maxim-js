import { RuleGroupType, RuleType } from "./models/deployment";

export interface IncomingQuery {
	query: string; // Comma-separated conditions with different operators
	operator: "AND" | "OR"; // Operator to use for conditions ('and', 'or')
	exactMatch: boolean; // Whether to match the exact query or not
}

export interface QueryObject {
	id: string;
	query: RuleGroupType;
}

// Function to parse the incoming query into a format compatible with RuleType
export function parseIncomingQuery(incomingQuery: string): RuleType[] {
	if (incomingQuery.trim().length === 0) {
		return [];
	}
	const operators = ["!=", ">=", "<=", ">", "<", "includes", "does not include", "="]; // Ensure longer operators come first
	return incomingQuery.split(",").map((condition) => {
		for (let op of operators) {
			if (condition.includes(op)) {
				let [field, value] = condition.split(op).map((s) => s.trim());
				const operator: RuleType["operator"] = op as RuleType["operator"];
				let exactMatch = false;
				if (field.startsWith("!!")) {
					exactMatch = true;
					field = field.slice(2);
				}
				// Here we will auto-parse the number values
				if (!isNaN(Number(value))) {
					return { field, value: Number(value), operator, exactMatch };
				}
				return { field: field, value, operator, exactMatch };
			}
		}
		throw new Error(`Unsupported operator found in condition "${condition}"`);
	});
}

// Recursive function to evaluate rule groups against incoming query rules
// TODO this flow is not optimized for nested queries
function evaluateRuleGroup(ruleGroup: RuleGroupType, incomingQueryRules: RuleType[]): boolean {
	// This will keep track of matched fields to be used for exact match
	const matchedRules: RuleType[] = [];
	const matchResults = ruleGroup.rules.map((rule) => {
		if ("combinator" in rule) {
			// It's a nested rule group
			return evaluateRuleGroup(rule, incomingQueryRules);
		} else {
			// It's a regular rule
			return incomingQueryRules.some((incomingRule) => {
				const conditionMet = (fieldRule: RuleType, fieldIncomingRule: RuleType): boolean => {
					// Checking for the type of the value
					if (typeof fieldRule.value !== typeof fieldIncomingRule.value) {
						// Here we will honor the type of the value in the rule
						// And try to cast incoming rule to that value
						if (typeof fieldRule.value === "number") {
							fieldIncomingRule.value = Number(fieldIncomingRule.value);
						} else if (typeof fieldRule.value === "boolean") {
							fieldIncomingRule.value = Boolean(fieldIncomingRule.value);
						} else if (typeof fieldRule.value === "string") {
							fieldIncomingRule.value = String(fieldIncomingRule.value);
						}
					}
					switch (fieldRule.operator) {
						case "=":
							return fieldRule.value === fieldIncomingRule.value;
						case "!=":
							return fieldRule.value !== fieldIncomingRule.value;
						case ">":
							return fieldRule.value > fieldIncomingRule.value;
						case "<":
							return fieldRule.value < fieldIncomingRule.value;
						case ">=":
							return fieldRule.value >= fieldIncomingRule.value;
						case "<=":
							return fieldRule.value <= fieldIncomingRule.value;
						case "includes":
							return (fieldRule.value as string[]).includes(fieldIncomingRule.value as string);
						case "does not include":
							return !(fieldRule.value as string[]).includes(fieldIncomingRule.value as string);
					}
					return false;
				};
				const result = rule.field === incomingRule.field && conditionMet(rule, incomingRule);
				if (result) {
					matchedRules.push(incomingRule);
				}
				return result;
			});
		}
	});
	// Here we will check if every exact match rule is matched
	// If not, we will return false
	const exactMatches = incomingQueryRules.every((rule) => {
		if (!rule.exactMatch) {
			return true;
		}
		if (matchedRules.includes(rule)) {
			return true;
		}
		return false;
	});
	if (!exactMatches) {
		return false;
	}
	if (ruleGroup.combinator === "AND") {
		return matchResults.every(Boolean);
	} else {
		return matchResults.some(Boolean);
	}
}

// Function to find the best match based on the incoming query
export function findBestMatch(objects: QueryObject[], incomingQuery: IncomingQuery): QueryObject | null {
	let bestMatch: QueryObject | null = null;
	let maxMatchCount = 0;
	const incomingQueryRules = parseIncomingQuery(incomingQuery.query);
	for (const object of objects) {
		const isMatch = evaluateRuleGroup(object.query, incomingQueryRules);
		if (isMatch) {
			if (incomingQuery.exactMatch) {
				// Make all fields in the incomingQueryRule are matching with the object.query
				if (incomingQueryRules.length !== object.query.rules.length) {
					continue;
				}
			}
			const matchCount = object.query.rules.length;
			// Assume the first match found is the best match for simplicity
			if (matchCount > maxMatchCount) {
				maxMatchCount = matchCount;
				bestMatch = object;
			}
		}
	}
	return bestMatch;
}

// Function to find the best match based on the incoming query
export function findAllMatches(objects: QueryObject[], incomingQuery: IncomingQuery): QueryObject[] {
	let bestMatch: QueryObject | null = null;
	const matches: QueryObject[] = [];
	const incomingQueryRules = parseIncomingQuery(incomingQuery.query);
	for (const object of objects) {
		const isMatch = evaluateRuleGroup(object.query, incomingQueryRules);
		if (isMatch) {
			if (incomingQuery.exactMatch) {
				// Make all fields in the incomingQueryRule are matching with the object.query
				if (incomingQueryRules.length !== object.query.rules.length) {
					continue;
				}
			}
			matches.push(object);
		}
	}
	return matches;
}
