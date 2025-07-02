export enum QueryRuleType {
	DeploymentVar = "deploymentVar",
	Tag = "tag",
}

/**
 * Configuration object for prompt and prompt chain queries.
 *
 * Defines the parameters used to filter and select specific versions of prompts
 * or prompt chains based on deployment variables, tags, and matching criteria.
 * Used internally by the QueryBuilder to construct queries for the Maxim API.
 *
 * @property query - The query string containing comma-separated key=value pairs
 * @property operator - Logical operator for combining multiple criteria
 * @property exactMatch - Whether to require exact matching of all criteria
 * @property scopes - Additional scope filters like folder restrictions
 * @see {@link QueryBuilder} For constructing QueryRule objects
 * @example
 * // Example QueryRule structure
 * const rule: QueryRule = {
 *   query: "environment=production,version=v2.0",
 *   operator: "AND",
 *   exactMatch: true,
 *   scopes: { folder: "folder-123" }
 * };
 */
export type QueryRule = {
	query: string;
	operator: "AND" | "OR";
	exactMatch: boolean;
	scopes: Scopes;
};

export type Scopes = { [key: string]: string };

/**
 * Builder class for constructing queries to filter prompts and prompt chains.
 *
 * Provides an interface for building complex query rules that determine
 * which version of a prompt or prompt chain should be retrieved based on
 * deployment variables, tags, and other criteria. Essential for implementing
 * deployment strategies and A/B testing with prompts.
 *
 * @class QueryBuilder
 * @example
 * import { QueryBuilder } from '@maximai/maxim-js';
 *
 * // Basic deployment query
 * const rule = new QueryBuilder()
 *   .deploymentVar('environment', 'production')
 *   .deploymentVar('region', 'us-east-1')
 *   .build();
 *
 * const prompt = await maxim.getPrompt('prompt-id', rule);
 *
 * @example
 * // Complex query with tags and exact matching
 * const rule = new QueryBuilder()
 *   .exactMatch()
 *   .and()
 *   .deploymentVar('stage', 'prod', true) // enforced
 *   .tag('version', 'v2.0')
 *   .folder('marketing-prompts')
 *   .build();
 */
export class QueryBuilder {
	private query: string;
	private scopes: Scopes = {};
	private operator: "AND" | "OR";
	private isExactMatch = false;

	/**
	 * Creates a new QueryBuilder instance with default settings.
	 *
	 * Initializes with AND operator and exact matching disabled.
	 * Use the class methods to configure the query before calling build().
	 */
	constructor() {
		this.query = "";
		this.operator = "AND";
	}

	/**
	 * Sets the logical operator to AND for combining query criteria.
	 *
	 * With AND logic, all specified criteria must match for a prompt version
	 * to be selected. This is the default behavior.
	 *
	 * @returns This QueryBuilder instance for method chaining
	 * @example
	 * const rule = new QueryBuilder()
	 *   .and() // All conditions must match
	 *   .deploymentVar('env', 'prod')
	 *   .deploymentVar('region', 'us-east')
	 *   .build();
	 */
	public and(): QueryBuilder {
		this.operator = "AND";
		return this;
	}

	/**
	 * Sets the logical operator to OR for combining query criteria.
	 *
	 * With OR logic, any of the specified criteria can match for a prompt version
	 * to be selected. Useful for fallback scenarios and flexible matching.
	 *
	 * @returns This QueryBuilder instance for method chaining
	 * @example
	 * const rule = new QueryBuilder()
	 *   .or() // Any condition can match
	 *   .deploymentVar('feature_beta', true)
	 *   .deploymentVar('user_type', 'premium')
	 *   .build();
	 */
	public or(): QueryBuilder {
		this.operator = "OR";
		return this;
	}

	/**
	 * Restricts the query to a specific folder.
	 *
	 * Only prompts and prompt chains within the specified folder will be
	 * considered when evaluating the query criteria.
	 *
	 * @param folderId - The ID of the folder to restrict the query to
	 * @returns This QueryBuilder instance for method chaining
	 * @example
	 * const rule = new QueryBuilder()
	 *   .folder('marketing-folder-123')
	 *   .deploymentVar('campaign', 'summer-2024')
	 *   .build();
	 */
	public folder(folderId: string): QueryBuilder {
		this.scopes["folder"] = folderId;
		return this;
	}

	/**
	 * Enables exact matching mode for the query.
	 *
	 * When exact matching is enabled, prompt versions must have deployment
	 * configurations that exactly match the query criteria. No partial or
	 * fuzzy matching is performed.
	 *
	 * @returns This QueryBuilder instance for method chaining
	 * @example
	 * const rule = new QueryBuilder()
	 *   .exactMatch() // Require exact match
	 *   .deploymentVar('environment', 'production')
	 *   .build();
	 */
	public exactMatch(): QueryBuilder {
		this.isExactMatch = true;
		return this;
	}

	/**
	 * Adds a deployment variable constraint to the query.
	 *
	 * Deployment variables are used to control which version of a prompt is
	 * served based on runtime conditions like environment, user segments,
	 * feature flags, etc.
	 *
	 * @param key - The deployment variable name
	 * @param value - The required value for the variable
	 * @param enforce - Whether this variable must be present (defaults to true)
	 * @returns This QueryBuilder instance for method chaining
	 * @example
	 * const rule = new QueryBuilder()
	 *   .deploymentVar('environment', 'production') // Must match
	 *   .deploymentVar('feature_flag', true, false) // Optional match
	 *   .build();
	 *
	 * @example
	 * // Different data types
	 * new QueryBuilder()
	 *   .deploymentVar('region', 'us-west-2')      // string
	 *   .deploymentVar('max_users', 1000)          // number
	 *   .deploymentVar('beta_enabled', true)       // boolean
	 *   .build();
	 */
	public deploymentVar(key: string, value: string | number | boolean | string[], enforce: boolean = true) {
		if (this.query.length > 0) this.query += ",";
		this.query += `${enforce ? "!!" : ""}${key}=${Array.isArray(value) ? JSON.stringify(value) : value}`;
		return this;
	}

	/**
	 * Adds a tag constraint to the query.
	 *
	 * Tags provide additional metadata for organizing and filtering prompts.
	 * Unlike deployment variables, tags are typically used for categorization
	 * and organization rather than runtime deployment logic.
	 *
	 * @param key - The tag name
	 * @param value - The required value for the tag
	 * @param enforce - Whether this tag must be present (defaults to false)
	 * @returns This QueryBuilder instance for method chaining
	 * @example
	 * const rule = new QueryBuilder()
	 *   .tag('category', 'customer-service')
	 *   .tag('version', 'v2.1', true) // Enforced tag
	 *   .build();
	 *
	 * @example
	 * // Organizing by team and purpose
	 * new QueryBuilder()
	 *   .tag('team', 'marketing')
	 *   .tag('purpose', 'email-generation')
	 *   .tag('priority', 'high')
	 *   .build();
	 */
	public tag(key: string, value: string | number | boolean, enforce: boolean = false) {
		if (this.query.length > 0) this.query += ",";
		this.query += `${enforce ? "!!" : ""}${key}=${value}`;
		return this;
	}

	/**
	 * Builds and returns the final QueryRule object.
	 *
	 * Validates that at least one constraint has been added and constructs
	 * the final QueryRule with all specified criteria, operators, and scopes.
	 *
	 * @returns The constructed query rule ready for use with Maxim API methods
	 * @throws {Error} When no constraints have been added to the query
	 * @example
	 * const rule = new QueryBuilder()
	 *   .deploymentVar('env', 'prod')
	 *   .tag('version', 'stable')
	 *   .build();
	 *
	 * // Use with Maxim methods
	 * const prompt = await maxim.getPrompt('prompt-id', rule);
	 * const prompts = await maxim.getPrompts(rule);
	 */
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
