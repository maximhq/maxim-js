export enum QueryRuleType {
	DeploymentVar = "deploymentVar",
	Tag = "tag",
}

export type QueryRule = {
	query: string;
	operator: "AND" | "OR";
	exactMatch: boolean;
	scopes: Scopes;
};

type Scopes = { [key: string]: string };

export class QueryBuilder {
	private query: string;
	private scopes: Scopes = {};
	private operator: "AND" | "OR";
	private isExactMatch: boolean = false;

	constructor() {
		this.query = "";
		this.operator = "AND";
	}

	public and(): QueryBuilder {
		this.operator = "AND";
		return this;
	}

	public or(): QueryBuilder {
		this.operator = "OR";
		return this;
	}

	public folder(folderId: string): QueryBuilder {
		this.scopes["folder"] = folderId;
		return this;
	}

	public exactMatch(): QueryBuilder {
		this.isExactMatch = true;
		return this;
	}

	public deploymentVar(key: string, value: string | number | boolean, enforce: boolean = true) {
		if (this.query.length > 0) this.query += ",";
		this.query += `${enforce ? "!!" : ""}${key}=${value}`;
		return this;
	}

	public tag(key: string, value: string | number | boolean, enforce: boolean = false) {
		if (this.query.length > 0) this.query += ",";
		this.query += `${enforce ? "!!" : ""}${key}=${value}`;
		return this;
	}

	public build(): QueryRule {
		if (this.query.trim().length === 0) {
			throw new Error("Cannot build an empty query. Please add at least one rule (deploymentVar or tag).");
		}
		return {
			query: this.query,
			operator: this.operator,
			exactMatch: this.isExactMatch,
			scopes: this.scopes,
		};
	}
}
