export type RuleType = {
	field: string;
	value: string | number | string[] | boolean;
	operator: string;
	valueSource?: string;
	exactMatch?: boolean;
};

export type RuleGroupType = {
	not: boolean;
	rules: RuleType[] | RuleGroupType[];
	combinator: string;
};

export type DeploymentRules = {
	version: number;
	query?: RuleGroupType;
};

export type VersionSpecificDeploymentConfig = {
	id: string;
	timestamp: Date;
	rules: DeploymentRules;
	isFallback: boolean;
};

export type DeploymentVersionDeploymentConfig = {
	[key: string]: VersionSpecificDeploymentConfig[];
};

export type MaximAPIResponse = {
	error?: { message: string };
};
