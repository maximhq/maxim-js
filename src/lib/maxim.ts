import { MaximDatasetAPI } from "./apis/dataset";
import { MaximFolderAPI } from "./apis/folder";
import { MaximLogsAPI } from "./apis/logs";
import { MaximPromptAPI } from "./apis/prompt";
import { MaximPromptChainAPI } from "./apis/promptChain";
import { MaximCache } from "./cache/cache";
import { MaximInMemoryCache } from "./cache/inMemory";
import { IncomingQuery, QueryObject, findAllMatches, findBestMatch, parseIncomingQuery } from "./filterObjects";
import { LoggerConfig, MaximLogger } from "./logger/logger";
import { DatasetEntry } from "./models/dataset";
import { RuleGroupType } from "./models/deployment";
import { Folder } from "./models/folder";
import { ImageUrl, Prompt, PromptVersionsAndRules } from "./models/prompt";
import { PromptChain, PromptChainVersionsAndRules } from "./models/promptChain";
import { QueryRule } from "./models/queryBuilder";
import { type TestRunBuilder } from "./models/testRun";
import { createTestRunBuilder } from "./testRun/testRun";

declare global {
	var __maxim__sdk__instances__: Map<string, Maxim>;
}

export type Config = {
	/**
	 * Base URL for the Maxim API.
	 * @default "https://app.getmaxim.ai"
	 */
	baseUrl?: string;

	/**
	 * API key for authenticating requests to the Maxim API.
	 * Required for all API calls.
	 * @see https://app.getmaxim.ai/workspace?redirect=/settings/api-keys to generate your API key
	 */
	apiKey: string;

	/**
	 * Enable prompt management features.
	 * When enabled, allows synchronization of prompts, prompt chains, and folders from Maxim.
	 * @default false
	 */
	promptManagement?: boolean;

	/**
	 * Custom cache implementation for storing and retrieving data.
	 * @default InMemoryCache - Uses a simple in-memory caching mechanism
	 */
	cache?: MaximCache;

	/**
	 * Enable debug mode for additional logging and troubleshooting information.
	 * Useful during development and integration.
	 * @default false
	 */
	debug?: boolean;

	/**
	 * Raise exceptions instead of logging them.
	 * @default false
	 */
	raiseExceptions?: boolean;
};

enum EntityType {
	PROMPT,
	PROMPT_CHAIN,
	FOLDER,
}

export class Maxim {
	private readonly apiKey: string;
	private readonly baseUrl;
	private readonly isDebug: boolean;
	private intervalHandle?: NodeJS.Timeout;
	private cache: MaximCache;
	private isPromptManagementEnabled: boolean = false;
	private sync?: Promise<void>;
	private loggers: Map<string, MaximLogger> = new Map<string, MaximLogger>();
	private APIService: {
		prompt: MaximPromptAPI;
		promptChain: MaximPromptChainAPI;
		folder: MaximFolderAPI;
		dataset: MaximDatasetAPI;
		logs: MaximLogsAPI;
	};
	private _raiseExceptions: boolean;

	constructor(config: Config) {
		if (!config.apiKey) {
			throw new Error("[Maxim-SDK] API key is required");
		}
		// Check if an instance with the same API key already exists
		if (globalThis.__maxim__sdk__instances__ && globalThis.__maxim__sdk__instances__.get(config.apiKey)) {
			console.warn("[Maxim-SDK] You have initialized multiple instances of Maxim with the same API key.");
		}
		this.baseUrl = config.baseUrl || "https://app.getmaxim.ai";
		this.apiKey = config.apiKey;
		this._raiseExceptions = config.raiseExceptions || false;
		this.APIService = {
			prompt: new MaximPromptAPI(this.baseUrl, this.apiKey),
			promptChain: new MaximPromptChainAPI(this.baseUrl, this.apiKey),
			folder: new MaximFolderAPI(this.baseUrl, this.apiKey),
			dataset: new MaximDatasetAPI(this.baseUrl, this.apiKey),
			logs: new MaximLogsAPI(this.baseUrl, this.apiKey),
		};
		this.isDebug = config.debug || false;
		this.cache = config.cache || new MaximInMemoryCache();
		if (config.promptManagement) {
			this.isPromptManagementEnabled = true;
			this.sync = this.syncEntities();
			this.intervalHandle = setInterval(() => {
				this.syncEntities();
			}, 1000 * 60);

			// Call unref() to tell Node.js that this interval should not keep the process alive
			this.intervalHandle.unref();
		}
		// Initialize or update the global instances array
		if (!globalThis.__maxim__sdk__instances__) {
			globalThis.__maxim__sdk__instances__ = new Map<string, Maxim>();
		}
		globalThis.__maxim__sdk__instances__.set(this.apiKey, this);
	}

	// We will always bootstrap using REST call
	// Updates will be sent using realtime server
	private async syncEntities(): Promise<void> {
		try {
			return new Promise<void>((resolve, reject) => {
				Promise.all([this.syncPrompts(), this.syncFolders(), this.syncPromptChains()])
					.then(() => {
						resolve();
					})
					.catch((err) => {
						console.error(`[Maxim-SDK] ${err}`);
						resolve();
					});
			});
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while syncing entities: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	private async syncPrompts(): Promise<void> {
		try {
			await this.APIService.prompt.getPrompts().then(async (prompts) => {
				if (this.isDebug) {
					console.log(`[Maxim-SDK] Syncing ${prompts.length} prompts`);
				}
				await Promise.all(
					prompts.map(async (prompt) => {
						try {
							await this.cache.set(this.getCacheKey(EntityType.PROMPT, prompt.promptId), JSON.stringify(prompt));
						} catch (err) {
							console.error(err);
						}
					}),
				);
			});
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while syncing prompts: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	private async syncPromptChains(): Promise<void> {
		try {
			await this.APIService.promptChain.getPromptChains().then(async (promptChains) => {
				if (this.isDebug) {
					console.log(`[Maxim-SDK] Syncing ${promptChains.length} prompt chains`);
				}
				await Promise.all(
					promptChains.map(async (promptChain) => {
						try {
							await this.cache.set(this.getCacheKey(EntityType.PROMPT_CHAIN, promptChain.promptChainId), JSON.stringify(promptChain));
						} catch (err) {
							console.error(err);
						}
					}),
				);
			});
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while syncing prompt chains: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	private async syncFolders(): Promise<void> {
		try {
			await this.APIService.folder.getFolders().then(async (folders) => {
				if (this.isDebug) {
					console.log(`[Maxim-SDK] Syncing ${folders.length} folders`);
				}
				await Promise.all(
					folders.map(async (folder) => {
						try {
							await this.cache.set(this.getCacheKey(EntityType.FOLDER, folder.id), JSON.stringify(folder));
						} catch (err) {
							console.error(err);
						}
					}),
				);
			});
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while syncing folders: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	private async getPromptFromCache(key: string): Promise<PromptVersionsAndRules | null> {
		try {
			let data = await this.cache.get(key);
			if (!data) {
				return null;
			}
			return JSON.parse(data) as PromptVersionsAndRules;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching prompt from cache: ${err instanceof Error ? err.message : err}`);
				return null;
			}
		}
	}

	private async getAllPromptsFromCache(): Promise<PromptVersionsAndRules[] | null> {
		try {
			let keys = await this.cache.getAllKeys();
			if (!keys) {
				return null;
			}
			// Fetching all prompts
			let data = await Promise.all(keys.filter((key) => key.startsWith("prompt:")).map((key) => this.cache.get(key)));
			return data.filter((d) => d !== null).map((d) => JSON.parse(d!) as PromptVersionsAndRules);
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching all prompts from cache: ${err instanceof Error ? err.message : err}`);
				return null;
			}
		}
	}

	private async getPromptChainFromCache(key: string): Promise<PromptChainVersionsAndRules | null> {
		try {
			let data = await this.cache.get(key);
			if (!data) {
				return null;
			}
			return JSON.parse(data) as PromptChainVersionsAndRules;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching prompt chain from cache: ${err instanceof Error ? err.message : err}`);
				return null;
			}
		}
	}

	private async getAllPromptChainsFromCache(): Promise<PromptChainVersionsAndRules[] | null> {
		try {
			let keys = await this.cache.getAllKeys();
			if (!keys) {
				return null;
			}
			// Fetching all prompts
			let data = await Promise.all(keys.filter((key) => key.startsWith("promptChain:")).map((key) => this.cache.get(key)));
			return data.filter((d) => d !== null).map((d) => JSON.parse(d!) as PromptChainVersionsAndRules);
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching all prompt chains from cache: ${err instanceof Error ? err.message : err}`);
				return null;
			}
		}
	}

	private async getFolderFromCache(key: string): Promise<Folder | null> {
		try {
			let data = await this.cache.get(key);
			if (!data) {
				return null;
			}
			return JSON.parse(data) as Folder;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching folder from cache: ${err instanceof Error ? err.message : err}`);
				return null;
			}
		}
	}

	private async getAllFoldersFromCache(): Promise<Folder[] | null> {
		try {
			let keys = await this.cache.getAllKeys();
			if (!keys) {
				return null;
			}
			// Fetching all prompts
			let data = await Promise.all(keys.filter((key) => key.startsWith("folder:")).map((key) => this.cache.get(key)));
			return data.filter((d) => d !== null).map((d) => JSON.parse(d!) as Folder);
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching all folders from cache: ${err instanceof Error ? err.message : err}`);
				return null;
			}
		}
	}

	private getCacheKey(entity: EntityType, id: string): string {
		switch (entity) {
			case EntityType.PROMPT:
				return `prompt:${id}`;
			case EntityType.PROMPT_CHAIN:
				return `promptChain:${id}`;
			case EntityType.FOLDER:
				return `folder:${id}`;
		}
	}

	private getPromptVersionForRule(promptVersionAndRules: PromptVersionsAndRules, rule?: QueryRule): Prompt | undefined {
		try {
			if (rule) {
				let incomingQuery: IncomingQuery = {
					query: rule.query,
					operator: rule.operator,
					exactMatch: rule.exactMatch,
				};
				const objects: QueryObject[] = [];
				Object.keys(promptVersionAndRules.rules).forEach((versionId) => {
					const versionRules = promptVersionAndRules!.rules[versionId];
					versionRules.forEach((versionRule) => {
						if (!versionRule.rules.query) {
							return;
						}
						// Checking for scope and type of scope and filtering candidates
						if (rule.scopes) {
							Object.keys(rule.scopes).forEach((key) => {
								switch (key) {
									case "folder":
										break;
									default:
										throw new Error("Invalid scope added");
								}
							});
						}
						const version = promptVersionAndRules?.versions.find((v) => v.id === versionId);
						const query: RuleGroupType = versionRule.rules.query;
						if (!version) return;
						// Here we will attach tags to that query
						if (version.config?.tags) {
							const parsedIncomingQuery = parseIncomingQuery(incomingQuery.query);
							const tags = version.config.tags;
							// Generating QueryType from key value pair in tags
							Object.keys(tags)
								.filter((key) => tags[key] !== undefined)
								.filter((key) => parsedIncomingQuery.map((incomingQueryRule) => incomingQueryRule.field).includes(key))
								.forEach((key) => {
									query.rules.push({ field: key, operator: "=", value: tags[key]! } as any);
								});
						}
						objects.push({
							query,
							id: versionId,
						});
					});
				});
				const deployedVersionObject = findBestMatch(objects, incomingQuery);
				if (deployedVersionObject) {
					const deployedVersion = promptVersionAndRules?.versions.find((v) => v.id === deployedVersionObject.id);
					return {
						promptId: deployedVersion!.promptId,
						versionId: deployedVersion!.id,
						version: deployedVersion!.version,
						messages: deployedVersion!.config?.messages,
						modelParameters: deployedVersion!.config?.modelParameters,
						model: deployedVersion!.config?.model,
						provider: deployedVersion!.config?.provider,
						tags: deployedVersion!.config?.tags,
						run: (input: string, options?: { imageUrls?: ImageUrl[]; variables?: { [key: string]: string } }) => {
							if (!deployedVersion) {
								throw new Error("[Maxim-SDK] Deployed version missing while attempting to run prompt");
							}
							return this.APIService.prompt.runPromptVersion(deployedVersion.id, input, options);
						},
					} as Prompt;
				}
			} else {
				// Checking version rules with rule being undefined
				for (const versionId in promptVersionAndRules.rules) {
					const versionRules = promptVersionAndRules.rules[versionId];
					let isMatch = false;
					for (const rule of versionRules) {
						if (rule.rules.query === undefined || rule.rules.query?.rules.length === 0) {
							isMatch = true;
							break;
						}
					}
					if (isMatch) {
						const deployedVersion = promptVersionAndRules.versions.find((v) => v.id === versionId);
						return {
							promptId: deployedVersion!.promptId,
							versionId: deployedVersion!.id,
							version: deployedVersion!.version,
							messages: deployedVersion!.config?.messages,
							modelParameters: deployedVersion!.config?.modelParameters,
							model: deployedVersion!.config?.model,
							provider: deployedVersion!.config?.provider,
							tags: deployedVersion!.config?.tags,
							run: (input: string, options?: { imageUrls?: ImageUrl[]; variables?: { [key: string]: string } }) => {
								if (!deployedVersion) {
									throw new Error("[Maxim-SDK] Deployed version missing while attempting to run prompt");
								}
								return this.APIService.prompt.runPromptVersion(deployedVersion.id, input, options);
							},
						} as Prompt;
					}
				}
			}
			if (promptVersionAndRules.fallbackVersion) {
				return {
					promptId: promptVersionAndRules.fallbackVersion!.promptId,
					versionId: promptVersionAndRules.fallbackVersion!.id,
					version: promptVersionAndRules.fallbackVersion!.version,
					...promptVersionAndRules.fallbackVersion.config!,
					run: (input: string, options?: { imageUrls?: ImageUrl[]; variables?: { [key: string]: string } }) => {
						if (!promptVersionAndRules.fallbackVersion?.id) {
							throw new Error("[Maxim-SDK] Deployed fallback version missing while attempting to run prompt");
						}
						return this.APIService.prompt.runPromptVersion(promptVersionAndRules.fallbackVersion.id, input, options);
					},
				} as Prompt;
			}
			return undefined;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching prompt version for rule: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	private getPromptChainVersionForRule(promptChainVersionAndRules: PromptChainVersionsAndRules, rule?: QueryRule): PromptChain | undefined {
		try {
			if (rule) {
				let incomingQuery: IncomingQuery = {
					query: rule.query,
					operator: rule.operator,
					exactMatch: rule.exactMatch,
				};
				const objects: QueryObject[] = [];
				Object.keys(promptChainVersionAndRules.rules).forEach((versionId) => {
					const versionRules = promptChainVersionAndRules!.rules[versionId];
					versionRules.forEach((versionRule) => {
						if (!versionRule.rules.query) {
							return;
						}
						// Checking for scope and type of scope and filtering candidates
						if (rule.scopes) {
							Object.keys(rule.scopes).forEach((key) => {
								switch (key) {
									case "folder":
										break;
									default:
										throw new Error("Invalid scope added");
								}
							});
						}
						const version = promptChainVersionAndRules?.versions.find((v) => v.id === versionId);
						const query: RuleGroupType = versionRule.rules.query;
						if (!version) return;
						// Here we will attach tags to that query
						objects.push({
							query,
							id: versionId,
						});
					});
				});
				const deployedVersionObject = findBestMatch(objects, incomingQuery);
				if (deployedVersionObject) {
					const deployedVersion = promptChainVersionAndRules?.versions.find((v) => v.id === deployedVersionObject.id);
					return {
						promptChainId: deployedVersion!.promptChainId,
						versionId: deployedVersion!.id,
						version: deployedVersion!.version,
						nodes: deployedVersion!.config?.nodes.filter((n) => "prompt" in n),
						run: (input: string, options?: { variables?: { [key: string]: string } }) => {
							if (!deployedVersion?.id) {
								throw new Error("[Maxim-SDK] Deployed version missing while attempting to run prompt chain");
							}
							return this.APIService.promptChain.runPromptChainVersion(deployedVersion.id, input, options);
						},
					} as PromptChain;
				}
			} else {
				// Checking version rules with rule being undefined
				for (const versionId in promptChainVersionAndRules.rules) {
					const versionRules = promptChainVersionAndRules.rules[versionId];
					let isMatch = false;
					for (const rule of versionRules) {
						if (rule.rules.query === undefined || rule.rules.query?.rules.length === 0) {
							isMatch = true;
							break;
						}
					}
					if (isMatch) {
						const deployedVersion = promptChainVersionAndRules.versions.find((v) => v.id === versionId);
						return {
							promptChainId: deployedVersion!.promptChainId,
							versionId: deployedVersion!.id,
							version: deployedVersion!.version,
							nodes: deployedVersion!.config?.nodes.filter((n) => "prompt" in n),
							run: (input: string, options?: { variables?: { [key: string]: string } }) => {
								if (!deployedVersion?.id) {
									throw new Error("[Maxim-SDK] Deployed version missing while attempting to run prompt chain");
								}
								return this.APIService.promptChain.runPromptChainVersion(deployedVersion.id, input, options);
							},
						} as PromptChain;
					}
				}
			}
			if (promptChainVersionAndRules.fallbackVersion) {
				return {
					promptChainId: promptChainVersionAndRules.fallbackVersion!.promptChainId,
					versionId: promptChainVersionAndRules.fallbackVersion!.id,
					version: promptChainVersionAndRules.fallbackVersion!.version,
					nodes: promptChainVersionAndRules.fallbackVersion!.config
						? promptChainVersionAndRules.fallbackVersion!.config.nodes.filter((n) => "prompt" in n)
						: [],
					run: (input: string, options?: { variables?: { [key: string]: string } }) => {
						if (!promptChainVersionAndRules.fallbackVersion?.id) {
							throw new Error("[Maxim-SDK] Deployed fallback version missing while attempting to run prompt chain");
						}
						return this.APIService.promptChain.runPromptChainVersion(promptChainVersionAndRules.fallbackVersion.id, input, options);
					},
				} as PromptChain;
			}
			return undefined;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching prompt chain version for rule: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	private getFoldersForRule(folders: Folder[], rule: QueryRule) {
		try {
			let incomingQuery: IncomingQuery = {
				query: rule.query,
				operator: rule.operator,
				exactMatch: rule.exactMatch,
			};
			const objects: QueryObject[] = [];
			folders.forEach((folder) => {
				const query: RuleGroupType = {
					combinator: "AND",
					not: false,
					rules: [],
				};
				if (!folder.tags) {
					return;
				}
				const parsedIncomingQuery = parseIncomingQuery(incomingQuery.query);
				const tags = folder.tags;
				Object.keys(tags)
					.filter((key) => tags[key] !== undefined)
					.filter((key) => parsedIncomingQuery.map((rule) => rule.field).includes(key))
					.forEach((key) => {
						query.rules.push({ field: key, operator: "=", value: tags[key]! } as any);
					});
				if (query.rules.length === 0) {
					return;
				}
				objects.push({
					query,
					id: folder.id,
				});
			});
			const folderObjects = findAllMatches(objects, incomingQuery);
			const ids = folderObjects.map((fo) => fo.id);
			return folders.filter((f) => ids.includes(f.id));
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching folders for rule: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	/**
	 * This method is used to get a prompt by id that matches the query rule
	 * @async
	 * @param {string} promptId - Prompt id to fetch
	 * @param {QueryRule} rule - Query rule to match
	 * @returns {Promise<Prompt>} a single prompt
	 * @throws {Error} If no active deployments found for the prompt matching the query rule and id
	 * @example
	 * const prompt = await maxim.getPrompt(
	 *  "promptId",
	 *  new QueryBuilder()
	 *      .and()
	 *      .deploymentVar("Environment", "Production")
	 *      .build()
	 * );
	 */
	public async getPrompt(promptId: string, rule: QueryRule): Promise<Prompt | undefined> {
		try {
			if (!this.isPromptManagementEnabled) {
				throw new Error("Prompt Management feature is not enabled. Please enable it in the configuration.");
			}
			await this.sync;
			const key = this.getCacheKey(EntityType.PROMPT, promptId);
			let versionAndRules: PromptVersionsAndRules | null = await this.getPromptFromCache(key);
			if (versionAndRules === null) {
				versionAndRules = await this.APIService.prompt.getPrompt(promptId);
				if (versionAndRules.versions.length === 0) {
					throw new Error(`No active deployments found for Prompt ${promptId}`);
				}
				await this.cache.set(promptId, JSON.stringify(versionAndRules));
			}
			if (!versionAndRules) {
				throw new Error(`No active deployments found for Prompt ${promptId}`);
			}
			const prompt = this.getPromptVersionForRule(versionAndRules, rule);
			if (!prompt) {
				throw new Error(`No active deployments found for Prompt ${promptId}`);
			}
			return prompt;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching prompt: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	/**
	 * This method is used to get all prompts that match the query rule
	 * @async
	 * @param {QueryRule} rule - Query rule to match
	 * @returns {Promise<Prompt[]>} Array of prompts
	 * @throws {Error} If no active deployments found for any prompt matching the query rule
	 * @example
	 * const prompts = await maxim.getPrompts(
	 *  new QueryBuilder()
	 *      .and()
	 *      .deploymentVar("Environment", "Production")
	 *      .build()
	 * );
	 */
	public async getPrompts(rule: QueryRule): Promise<Prompt[] | undefined> {
		try {
			if (!this.isPromptManagementEnabled) {
				throw new Error("Prompt Management feature is not enabled. Please enable it in the configuration.");
			}
			await this.sync;
			let versionAndRules: PromptVersionsAndRules[] | null = await this.getAllPromptsFromCache();
			if (versionAndRules === null || versionAndRules.length === 0) {
				// We will try to get all prompts from server (if something has gone wrong with initialization)
				await this.syncEntities();
				versionAndRules = await this.getAllPromptsFromCache();
			}
			if (!versionAndRules) {
				throw new Error(`No active deployments found for any prompt`);
			}
			let prompts: Prompt[] = versionAndRules
				.filter((v) => {
					if (Object.keys(rule.scopes).length === 0) {
						return true;
					}
					if (rule.scopes["folder"]) {
						return v.folderId === rule.scopes["folder"];
					}
					return true;
				})
				.map((v) => this.getPromptVersionForRule(v, rule))
				.filter((p) => p !== undefined) as Prompt[];

			if (prompts.length === 0) {
				throw new Error(`No active deployments found for any prompt`);
			}
			return prompts;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching prompts: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	/**
	 * This method is used to get a prompt chain by id that matches the query rule
	 * @async
	 * @param {string} promptChainId - Prompt chain id to fetch
	 * @param {QueryRule} rule - Query rule to match
	 * @returns {Promise<PromptChain>} a single prompt chain
	 * @throws {Error} If no active deployments found for the prompt chain matching the query rule and id
	 * @example
	 * const promptChain = await maxim.getPromptChain(
	 *  "promptChainId",
	 *  new QueryBuilder()
	 *      .and()
	 *      .deploymentVar("Environment", "Production")
	 *      .build()
	 * );
	 */
	public async getPromptChain(promptChainId: string, rule: QueryRule): Promise<PromptChain | undefined> {
		try {
			if (!this.isPromptManagementEnabled) {
				throw new Error("Prompt Management feature is not enabled. Please enable it in the configuration.");
			}
			await this.sync;
			const key = this.getCacheKey(EntityType.PROMPT_CHAIN, promptChainId);
			let versionAndRules: PromptChainVersionsAndRules | null = await this.getPromptChainFromCache(key);
			if (versionAndRules === null) {
				versionAndRules = await this.APIService.promptChain.getPromptChain(promptChainId);
				if (versionAndRules.versions.length === 0) {
					throw new Error(`No active deployments found for Prompt Chain ${promptChainId}`);
				}
				await this.cache.set(promptChainId, JSON.stringify(versionAndRules));
			}
			if (!versionAndRules) {
				throw new Error(`No active deployments found for Prompt Chain ${promptChainId}`);
			}
			const promptChain = this.getPromptChainVersionForRule(versionAndRules, rule);
			if (!promptChain) {
				throw new Error(`No active deployments found for Prompt Chain ${promptChainId}`);
			}
			return promptChain;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching prompt chain: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	/**
	 * This method is used to get all prompt chains that match the query rule
	 * @async
	 * @param {QueryRule} rule - Query rule to match
	 * @returns {Promise<PromptChain[]>} Array of prompt chains
	 * @throws {Error} If no active deployments found for any prompt chain matching the query rule
	 * @example
	 * const promptChains = await maxim.getPromptChains(
	 *  new QueryBuilder()
	 *      .and()
	 *      .deploymentVar("Environment", "Production")
	 *      .build()
	 * );
	 */
	public async getPromptChains(rule: QueryRule): Promise<PromptChain[] | undefined> {
		try {
			if (!this.isPromptManagementEnabled) {
				throw new Error("Prompt Management feature is not enabled. Please enable it in the configuration.");
			}
			await this.sync;
			let versionAndRules: PromptChainVersionsAndRules[] | null = await this.getAllPromptChainsFromCache();
			if (versionAndRules === null || versionAndRules.length === 0) {
				// We will try to get all prompts from server (if something has gone wrong with initialization)
				await this.syncEntities();
				versionAndRules = await this.getAllPromptChainsFromCache();
			}
			if (!versionAndRules) {
				throw new Error(`No active deployments found for any prompt chain`);
			}
			let promptChains: PromptChain[] = versionAndRules
				.filter((v) => {
					if (Object.keys(rule.scopes).length === 0) {
						return true;
					}
					if (rule.scopes["folder"]) {
						return v.folderId === rule.scopes["folder"];
					}
					return true;
				})
				.map((v) => this.getPromptChainVersionForRule(v, rule))
				.filter((p) => p !== undefined) as PromptChain[];

			if (promptChains.length === 0) {
				throw new Error(`No active deployments found for any prompt chain`);
			}
			return promptChains;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching prompt chains: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	/**
	 * This method is used to get a folder by id
	 * @async
	 * @param {string} folderId - Folder id to fetch
	 * @returns {Promise<Folder>} a single folder
	 * @throws {Error} If no folder found with id
	 * @example
	 * const folder = await maxim.getFolderById("folderId");
	 */
	public async getFolderById(folderId: string): Promise<Folder | undefined> {
		try {
			if (!this.isPromptManagementEnabled) {
				throw new Error("Prompt Management feature is not enabled. Please enable it in the configuration.");
			}
			await this.sync;
			const key = this.getCacheKey(EntityType.FOLDER, folderId);
			let folder: Folder | null = await this.getFolderFromCache(key);
			if (folder === null) {
				folder = await this.APIService.folder.getFolder(folderId);
				if (!folder) {
					throw new Error(`No folder found with id ${folderId}`);
				}
				await this.cache.set(key, JSON.stringify(folder));
			}
			return folder;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching folder by id: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	/**
	 * This method is used to get all folders that match the query rule
	 * @async
	 * @param {QueryRule} rule - Query rule to match
	 * @returns {Promise<Folder[]>} Array of folders
	 * @throws {Error} If no folders found matching the query rule
	 * @example
	 * const folders = await maxim.getFolders(
	 *  new QueryBuilder()
	 *      .and()
	 *      .deploymentVar("Environment", "Production")
	 *      .build()
	 * );
	 */
	public async getFolders(rule: QueryRule): Promise<Folder[] | undefined> {
		try {
			if (!this.isPromptManagementEnabled) {
				throw new Error("Prompt Management feature is not enabled. Please enable it in the configuration.");
			}
			await this.sync;
			let folders: Folder[] | null = await this.getAllFoldersFromCache();
			if (folders === null || folders.length === 0) {
				// We will try to get all prompts from server (if something has gone wrong with initialization)
				await this.syncEntities();
				folders = await this.getAllFoldersFromCache();
			}
			if (!folders) {
				throw new Error(`No folders found`);
			}
			return this.getFoldersForRule(folders, rule);
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while fetching folders: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	/**
	 * This method is used to add entries to a dataset
	 * @async
	 * @param {string} datasetId Dataset id to add entries to
	 * @param {DatasetEntry[]} entries Entries to add to the dataset
	 * @returns {Promise<void>} void
	 * @example
	 * await maxim.addDatasetEntries("datasetId", [
	 * 	{
	 * 		input: {
	 * 			type: VariableType.TEXT,
	 * 			payload: "cell value",
	 * 		},
	 * 	},
	 * ]);
	 */
	public async addDatasetEntries(datasetId: string, entries: DatasetEntry[]): Promise<void> {
		try {
			return this.APIService.dataset.addDatasetEntries(datasetId, entries);
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while adding dataset entries: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	/**
	 * This method is used to create a logger
	 * @async
	 * @param {LoggerConfig} config - Logger config
	 * @returns {Promise<MaximLogger>} Logger instance
	 * @throws {Error} If no log repository is found with the given id
	 * @example
	 * const logger = await maxim.logger({
	 * 	id: "logRepositoryId",
	 * 	autoFlush: true, // default value
	 * 	flushIntervalSeconds: 10, // default value
	 * });
	 */
	public async logger(config: LoggerConfig): Promise<MaximLogger | undefined> {
		try {
			if (this.isPromptManagementEnabled) await this.sync;
			// Checking if this log repository exist on server
			const exists = await this.APIService.logs.doesLogRepositoryExist(config.id);
			if (!exists) {
				if (config.id) {
					throw new Error(`Log repository not found.`);
				}
			}
			if (this.loggers.has(config.id)) {
				return this.loggers.get(config.id)!;
			}
			const logger = new MaximLogger({
				config: config,
				apiKey: this.apiKey,
				baseUrl: this.baseUrl,
				isDebug: this.isDebug,
				cache: this.cache,
				raiseExceptions: this._raiseExceptions,
			});
			this.loggers.set(config.id, logger);
			return logger;
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while creating logger: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	/**
	 * This method is used to create a test run
	 * @param {string} name - Name of the test run
	 * @param {string} inWorkspaceId - Workspace Id to create the test run in
	 * @returns {TestRunBuilder} Test run instance
	 * @example
	 * // You can keep chaining methods to
	 * // the created test run to configure it
	 * const testRun = maxim
	 *     .createTestRun(
	 *         "testRunName",
	 *         "workspaceId"
	 *     ); // .with___(...)
	 */
	public createTestRun(name: string, inWorkspaceId: string): TestRunBuilder<undefined> {
		return createTestRunBuilder({ baseUrl: this.baseUrl, apiKey: this.apiKey, name, workspaceId: inWorkspaceId, evaluators: [] });
	}

	/**
	 * This method is used to cleanup all loggers and interval handles for syncing entities
	 * @async
	 */
	public async cleanup() {
		try {
			// Cleaning up all loggers
			if (this.intervalHandle) {
				clearInterval(this.intervalHandle);
			}
			await Promise.all(Array.from(this.loggers.values()).map((logger) => logger.cleanup()));
			if (globalThis.__maxim__sdk__instances__.get(this.apiKey)) {
				globalThis.__maxim__sdk__instances__.delete(this.apiKey);
			}

			// Destroy API service agents
			this.APIService.prompt.destroyAgents();
			this.APIService.promptChain.destroyAgents();
			this.APIService.folder.destroyAgents();
			this.APIService.dataset.destroyAgents();
			this.APIService.logs.destroyAgents();
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while cleaning up: ${err instanceof Error ? err.message : err}`);
			}
		}
	}
}
