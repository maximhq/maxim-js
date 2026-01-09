import { ChatCompletionResult, GenerationConfig } from "../lib/logger/components/generation";
import { Span } from "../lib/logger/components/span";
import { Trace } from "../lib/logger/components/trace";
import { MaximDatasetAPI } from "./apis/dataset";
import { MaximFolderAPI } from "./apis/folder";
import { MaximLogsAPI } from "./apis/logs";
import { MaximPromptAPI } from "./apis/prompt";
import { MaximPromptChainAPI } from "./apis/promptChain";
import { MaximCache } from "./cache/cache";
import { MaximInMemoryCache } from "./cache/inMemory";
import { IncomingQuery, QueryObject, findAllMatches, findBestMatch, parseIncomingQuery } from "./filterObjects";
import { LoggerConfig, MaximLogger } from "./logger/logger";
import { uniqueId } from "./logger/utils";
import type { DatasetEntry } from "./models/dataset";
import { RuleGroupType } from "./models/deployment";
import { Folder } from "./models/folder";
import {
	ChatCompletionMessage,
	CompletionRequest,
	ImageUrl,
	Prompt,
	PromptResponse,
	PromptVersion,
	PromptVersionsAndRules,
} from "./models/prompt";
import { PromptChain, PromptChainVersionsAndRules } from "./models/promptChain";
import { QueryRule } from "./models/queryBuilder";
import { type TestRunBuilder } from "./models/testRun";
import { platform } from "./platform";

import { createTestRunBuilder } from "./testRun/testRun";
import ExpiringKeyValueStore from "./utils/expiringKeyValueStore";

declare global {
	var __maxim__sdk__instances__: Map<string, Maxim>;
}

/**
 * Configuration object for initializing the Maxim SDK.
 */
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

/**
 * Main class for the Maxim SDK that provides access to all platform features.
 *
 * The Maxim class is the primary entry point for interacting with the Maxim
 * observability platform. It provides methods for prompt management, logging,
 * dataset operations, and test run execution. The class handles authentication,
 * caching, and API communication.
 *
 * @class Maxim
 * @example
 * import { Maxim } from '@maximai/maxim-js';
 *
 * // Basic initialization
 * const maxim = new Maxim({
 *   apiKey: 'your-api-key'
 * });
 *
 * @example
 * // Full configuration
 * const maxim = new Maxim({
 *   apiKey: 'your-api-key',
 *   baseUrl: 'https://app.getmaxim.ai',
 *   promptManagement: true,
 *   debug: true,
 *   cache: new CustomCacheImplementation()
 * });
 *
 * @example
 * // Using prompt management
 * const maxim = new Maxim({
 *   apiKey: 'your-api-key',
 *   promptManagement: true
 * });
 *
 * // Get a prompt with deployment rules
 * const rule = new QueryBuilder()
 *   .deploymentVar('environment', 'production')
 *   .tag('version', 'v2.0')
 *   .build();
 *
 * const prompt = await maxim.getPrompt('prompt-id', rule);
 * if (prompt) {
 *   const response = await prompt.run('Hello world');
 *   console.log(response.choices[0].message.content);
 * }
 *
 * @example
 * // Creating and running test runs
 * const testResult = await maxim
 *   .createTestRun('sample-test-run', 'workspace-id')
 *   .withDataStructure({
 *     input: 'INPUT',
 *     expectedOutput: 'EXPECTED_OUTPUT'
 *   })
 *   .withData('dataset-id')
 *   .withEvaluators('bias', 'toxicity')
 *   .yieldsOutput(async (data) => {
 *     const response = await callYourModel(data.input);
 *     return { data: response };
 *   })
 *   .run();
 *
 * @example
 * // Logging with Maxim
 * const logger = await maxim.logger({ id: 'my-app' });
 * const session = logger.session({ id: 'session-1', name: 'User session' });
 * const trace = session.trace({ id: 'trace-1', name: 'Query Processing', sessionId: 'session-1' });
 *
 * // ... Log other operations
 *
 * trace.end();
 *
 * // finally, before app shutdown
 * await maxim.cleanup();
 */
export class Maxim {
	private readonly apiKey: string;
	private readonly baseUrl;
	private readonly isDebug: boolean;
	private intervalHandle?: NodeJS.Timeout;
	private cache: MaximCache;
	private isPromptManagementEnabled: boolean = false;
	private sync?: Promise<void>;
	private loggers: Map<string, MaximLogger> = new Map<string, MaximLogger>();
	private promptVersionByNumberCache: ExpiringKeyValueStore<Prompt> = new ExpiringKeyValueStore<Prompt>();
	private APIService: {
		prompt: MaximPromptAPI;
		promptChain: MaximPromptChainAPI;
		folder: MaximFolderAPI;
		dataset: MaximDatasetAPI;
		logs: MaximLogsAPI;
	};
	private _raiseExceptions: boolean;

	/**
	 * Creates a new Maxim SDK instance.
	 *
	 * @param config - Configuration object for the SDK
	 * @throws {Error} When the API key is not provided
	 * @important **CRITICAL**: Always call `cleanup()` before your application
	 * exits. Failure to do so may result in memory leaks, unflushed data, or
	 * hanging processes. This is especially important in production environments
	 * and long-running applications.
	 * @example
	 * const maxim = new Maxim({
	 *   apiKey: process.env.MAXIM_API_KEY,
	 *   promptManagement: true,
	 *   debug: process.env.NODE_ENV === 'development'
	 * });
	 *
	 * @example
	 * // With custom cache
	 * import { RedisCacheImplementation } from './custom-cache';
	 *
	 * const maxim = new Maxim({
	 *   apiKey: 'your-api-key',
	 *   cache: new RedisCacheImplementation({
	 *     host: 'localhost',
	 *     port: 6379
	 *   })
	 * });
	 *
	 * // Always remember to cleanup before exit
	 * process.on('SIGINT', async () => {
	 *   await maxim.cleanup();
	 *   process.exit(0);
	 * });
	 */
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
		this.isDebug = config.debug || false;
		this.APIService = {
			prompt: new MaximPromptAPI(this.baseUrl, this.apiKey, this.isDebug),
			promptChain: new MaximPromptChainAPI(this.baseUrl, this.apiKey, this.isDebug),
			folder: new MaximFolderAPI(this.baseUrl, this.apiKey, this.isDebug),
			dataset: new MaximDatasetAPI(this.baseUrl, this.apiKey, this.isDebug),
			logs: new MaximLogsAPI(this.baseUrl, this.apiKey, this.isDebug),
		};
		this.cache = config.cache || new MaximInMemoryCache();
		if (config.promptManagement) {
			this.isPromptManagementEnabled = true;
			this.sync = this.syncEntities();
			this.intervalHandle = platform.timers.setInterval(() => {
				this.syncEntities();
			}, 1000 * 60);

			// Call unref() to tell Node.js that this interval should not keep the process alive
			platform.timers.maybeUnref(this.intervalHandle);
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
		const sdk = this;
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
					let prompt: Prompt;
					prompt = {
						promptId: deployedVersion!.promptId,
						versionId: deployedVersion!.id,
						version: deployedVersion!.version,
						messages: deployedVersion!.config?.messages,
						modelParameters: deployedVersion!.config?.modelParameters || {},
						model: deployedVersion!.config?.model || "",
						deploymentId: deployedVersion!.config?.deploymentId,
						provider: deployedVersion!.config?.provider || "",
						tags: deployedVersion!.config?.tags || {},
						run: async function (input: string, options?: { imageUrls?: ImageUrl[]; variables?: { [key: string]: string } }) {
							if (!deployedVersion) {
								throw new Error("[Maxim-SDK] Deployed version missing while attempting to run prompt");
							}

							return executePromptWithLogging(this.parent, this.generationConfig, deployedVersion, options, () =>
								sdk.APIService.prompt.runPromptVersion(deployedVersion.id, input, options),
							);
						},
						withLogger: function (parent, generationConfig) {
							const newPrompt: Prompt = {
								...this,
								parent,
								generationConfig,
							};
							return newPrompt;
						},
					} as Prompt;
					return prompt;
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
						let prompt: Prompt;
						prompt = {
							promptId: deployedVersion!.promptId,
							versionId: deployedVersion!.id,
							version: deployedVersion!.version,
							messages: deployedVersion!.config?.messages,
							modelParameters: deployedVersion!.config?.modelParameters || {},
							model: deployedVersion!.config?.model || "",
							deploymentId: deployedVersion!.config?.deploymentId,
							provider: deployedVersion!.config?.provider || "",
							tags: deployedVersion!.config?.tags || {},
							run: async function (input: string, options?: { imageUrls?: ImageUrl[]; variables?: { [key: string]: string } }) {
								if (!deployedVersion) {
									throw new Error("[Maxim-SDK] Deployed version missing while attempting to run prompt");
								}
								return executePromptWithLogging(this.parent, this.generationConfig, deployedVersion, options, () =>
									sdk.APIService.prompt.runPromptVersion(deployedVersion.id, input, options),
								);
							},
							withLogger: function (parent, generationConfig) {
								const newPrompt: Prompt = {
									...this,
									parent,
									generationConfig,
								};
								return newPrompt;
							},
						} as Prompt;
						return prompt;
					}
				}
			}
			if (promptVersionAndRules.fallbackVersion) {
				let prompt: Prompt;
				prompt = {
					promptId: promptVersionAndRules.fallbackVersion!.promptId,
					versionId: promptVersionAndRules.fallbackVersion!.id,
					version: promptVersionAndRules.fallbackVersion!.version,
					...promptVersionAndRules.fallbackVersion.config,
					messages: promptVersionAndRules.fallbackVersion.config?.messages || [],
					modelParameters: promptVersionAndRules.fallbackVersion.config?.modelParameters || {},
					model: promptVersionAndRules.fallbackVersion.config?.model || "",
					provider: promptVersionAndRules.fallbackVersion.config?.provider || "",
					tags: promptVersionAndRules.fallbackVersion.config?.tags || {},
					run: async function (input: string, options?: { imageUrls?: ImageUrl[]; variables?: { [key: string]: string } }) {
						if (!promptVersionAndRules.fallbackVersion?.id) {
							throw new Error("[Maxim-SDK] Deployed fallback version missing while attempting to run prompt");
						}
						return executePromptWithLogging(this.parent, this.generationConfig, promptVersionAndRules.fallbackVersion!, options, () =>
							sdk.APIService.prompt.runPromptVersion(promptVersionAndRules.fallbackVersion!.id, input, options),
						);
					},
					withLogger: function (parent, generationConfig) {
						const newPrompt: Prompt = {
							...this,
							parent,
							generationConfig,
						};
						return newPrompt;
					},
				} as Prompt;
				return prompt;
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
	 * Retrieves a specific prompt by ID that matches the given query rule.
	 *
	 * This method fetches a prompt from the Maxim platform based on deployment rules
	 * and query criteria. It supports versioning and rule-based prompt selection.
	 *
	 * @async
	 * @param promptId - The unique identifier of the prompt to fetch
	 * @param rule - Query rule defining deployment variables, tags, and matching criteria
	 * @returns The matching prompt with run capabilities, or undefined if not found
	 * @throws {Error} When prompt management is not enabled
	 * @throws {Error} When no active deployments found for the prompt matching the query rule
	 * @example
	 * import { QueryBuilder } from '@maximai/maxim-js';
	 *
	 * const rule = new QueryBuilder()
	 *   .deploymentVar('environment', 'production')
	 *   .tag('version', 'v2.0')
	 *   .build();
	 *
	 * const prompt = await maxim.getPrompt('user-greeting-prompt-id', rule);
	 * if (prompt) {
	 *   const response = await prompt.run('Hello!', {
	 *     variables: { userName: 'John' },
	 *     imageUrls: []
	 *   });
	 *   console.log(response.choices[0].message.content);
	 * }
	 *
	 * @example
	 * // Using folder-scoped queries
	 * const rule = new QueryBuilder()
	 *   .folder('customer-service-folder')
	 *   .deploymentVar('language', 'en')
	 *   .build();
	 *
	 * const prompt = await maxim.getPrompt('support-template', rule);
	 */
	public async getPrompt(promptId: string, rule: QueryRule): Promise<Prompt | undefined> {
		const sdk = this;
		try {
			if (!this.isPromptManagementEnabled) {
				throw new Error("Prompt Management feature is not enabled. Please enable it in the configuration.");
			}
			await this.sync;
			// Short-circuit: if only condition is promptVersionNumber, fetch exact version with 60s TTL
			const parsed = parseIncomingQuery(rule.query);
			if (parsed.length === 1 && parsed[0].field === "promptVersionNumber" && parsed[0].operator === "=") {
				const num = Number(parsed[0].value);
				if (isNaN(num)) {
					throw new Error("Invalid promptVersionNumber value");
				}
				const cacheKey = `pvnum:${promptId}:${num}`;
				const cached = this.promptVersionByNumberCache.get(cacheKey);
				if (cached) {
					return cached;
				}
				const versionAndRules = await this.APIService.prompt.getPrompt(promptId, num);
				if (!versionAndRules || versionAndRules.versions.length === 0) {
					throw new Error(`No active deployments found for Prompt ${promptId}`);
				}
				const deployedVersion = versionAndRules.versions.find((v) => v.version === num);
				if (!deployedVersion) {
					throw new Error(`No version ${num} found for Prompt ${promptId}`);
				}
				let prompt: Prompt;
				prompt = {
					promptId: deployedVersion.promptId,
					versionId: deployedVersion.id,
					version: deployedVersion.version,
					messages: deployedVersion.config?.messages || [],
					modelParameters: deployedVersion.config?.modelParameters || {},
					model: deployedVersion.config?.model || "",
					deploymentId: deployedVersion.config?.deploymentId,
					provider: deployedVersion.config?.provider || "",
					tags: deployedVersion.config?.tags || {},
					run: async function (input: string, options?: { imageUrls?: ImageUrl[]; variables?: { [key: string]: string } }) {
						return executePromptWithLogging(this.parent, this.generationConfig, deployedVersion, options, () =>
							sdk.APIService.prompt.runPromptVersion(deployedVersion.id, input, options),
						);
					},
					withLogger: function (parent, generationConfig) {
						const newPrompt: Prompt = {
							...this,
							parent,
							generationConfig,
						};
						return newPrompt;
					},
				};
				this.promptVersionByNumberCache.set(cacheKey, prompt, 60);
				return prompt;
			}
			const key = this.getCacheKey(EntityType.PROMPT, promptId);

			// check if prompt is present in cache
			let versionAndRules: PromptVersionsAndRules | null = await this.getPromptFromCache(key);

			// If not present in cache, we make an API call and set in cache
			if (versionAndRules === null) {
				versionAndRules = await this.APIService.prompt.getPrompt(promptId);
				if (versionAndRules.versions.length === 0) {
					throw new Error(`No active deployments found for Prompt ${promptId}`);
				}
				await this.cache.set(promptId, JSON.stringify(versionAndRules));
			}
			// Neither present in cache nor received via API call
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
	 * Retrieves all prompts that match the given query rule.
	 *
	 * This method fetches multiple prompts from the Maxim platform based on
	 * deployment rules and query criteria. Useful for getting all prompts
	 * within a specific folder or matching certain deployment variables.
	 *
	 * @async
	 * @param rule - Query rule defining deployment variables, tags, and matching criteria
	 * @returns Array of matching prompts with run capabilities, or undefined if none found
	 * @throws {Error} When prompt management is not enabled
	 * @throws {Error} When no active deployments found for any prompt matching the query rule
	 * @example
	 * import { QueryBuilder } from '@maximai/maxim-js';
	 *
	 * // Get all production prompts in a specific folder
	 * const rule = new QueryBuilder()
	 *   .folder('customer-support')
	 *   .deploymentVar('environment', 'production')
	 *   .build();
	 *
	 * const prompts = await maxim.getPrompts(rule);
	 * if (prompts) {
	 *   for (const prompt of prompts) {
	 *     console.log(`Prompt: ${prompt.promptId}, Version: ${prompt.version}`);
	 *   }
	 * }
	 *
	 * @example
	 * // Get all prompts with specific tags
	 * const rule = new QueryBuilder()
	 *   .tag('category', 'greeting')
	 *   .tag('language', 'english')
	 *   .and()
	 *   .build();
	 *
	 * const greetingPrompts = await maxim.getPrompts(rule);
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
	 * Retrieves a specific prompt chain by ID that matches the given query rule.
	 *
	 * This method fetches a prompt chain from the Maxim platform based on deployment rules
	 * and query criteria. It supports versioning and rule-based prompt chain selection.
	 * Prompt chains allow you to orchestrate multiple prompts in sequence with conditional logic.
	 *
	 * @async
	 * @param promptChainId - The unique identifier of the prompt chain to fetch
	 * @param rule - Query rule defining deployment variables, tags, and matching criteria
	 * @returns The matching prompt chain with run capabilities, or undefined if not found
	 * @throws {Error} When prompt management is not enabled
	 * @throws {Error} When no active deployments found for the prompt chain matching the query rule
	 * @example
	 * import { QueryBuilder } from '@maximai/maxim-js';
	 *
	 * const rule = new QueryBuilder()
	 *   .deploymentVar('environment', 'production')
	 *   .tag('version', 'v2.0')
	 *   .build();
	 *
	 * const promptChain = await maxim.getPromptChain('user-onboarding-chain-id', rule);
	 * if (promptChain) {
	 *   const response = await promptChain.run('New user registration', {
	 *     variables: { userName: 'John', userType: 'premium' }
	 *   });
	 *   console.log(response.finalOutput);
	 * }
	 *
	 * @example
	 * // Using folder-scoped queries
	 * const rule = new QueryBuilder()
	 *   .folder('customer-onboarding-folder')
	 *   .deploymentVar('language', 'en')
	 *   .build();
	 *
	 * const promptChain = await maxim.getPromptChain('welcome-sequence', rule);
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
	 * Retrieves all prompt chains that match the given query rule.
	 *
	 * This method fetches multiple prompt chains from the Maxim platform based on
	 * deployment rules and query criteria. Useful for getting all prompt chains
	 * within a specific folder or matching certain deployment variables.
	 *
	 * @async
	 * @param rule - Query rule defining deployment variables, tags, and matching criteria
	 * @returns Array of matching prompt chains with run capabilities, or undefined if none found
	 * @throws {Error} When prompt management is not enabled
	 * @throws {Error} When no active deployments found for any prompt chain matching the query rule
	 * @example
	 * import { QueryBuilder } from '@maximai/maxim-js';
	 *
	 * // Get all production prompt chains in a specific folder
	 * const rule = new QueryBuilder()
	 *   .folder('customer-support')
	 *   .deploymentVar('environment', 'production')
	 *   .build();
	 *
	 * const promptChains = await maxim.getPromptChains(rule);
	 * if (promptChains) {
	 *   for (const promptChain of promptChains) {
	 *     console.log(`Prompt Chain: ${promptChain.promptChainId}, Version: ${promptChain.version}`);
	 *   }
	 * }
	 *
	 * @example
	 * // Get all prompt chains with specific tags
	 * const rule = new QueryBuilder()
	 *   .tag('category', 'workflow')
	 *   .tag('complexity', 'advanced')
	 *   .and()
	 *   .build();
	 *
	 * const workflowChains = await maxim.getPromptChains(rule);
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
	 * @param folderId - Folder id to fetch
	 * @returns a single folder
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
	 * @param rule - Query rule to match
	 * @returns Array of folders
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
	 * @param datasetId Dataset id to add entries to
	 * @param entries Entries to add to the dataset
	 * @returns void
	 * @example
	 * await maxim.addDatasetEntries("datasetId", [
	 * 	{
	 * 		columnName: "input",
	 * 		cellValue: {
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
	 * Creates a logger instance for capturing observability data.
	 *
	 * The logger provides methods for tracking sessions, traces, generations, and
	 * other observability events. It handles buffering, batching, and sending data
	 * to the Maxim platform.
	 *
	 * @async
	 * @param config - Configuration for the logger instance
	 * @returns Logger instance for capturing observability data, or undefined if creation fails
	 * @throws {Error} When the specified log repository is not found
	 * @example
	 * // Basic logger creation
	 * const logger = await maxim.logger({
	 *   id: 'my-repository-id',
	 * });
	 *
	 * if (logger) {
	 *   // Create a session for user interactions
	 *   const session = logger.session({
	 *     id: 'user-session-123',
	 *     name: 'Customer Support Chat'
	 *   });
	 *
	 *   // Create a trace for a specific operation
	 *   const trace = session.trace({
	 *     id: 'query-trace-456',
	 *     name: 'Customer Query Processing'
	 *   });
	 *
	 *   // ... Log other operations
	 *
	 *   trace.end();
	 *
	 *   // finally, before app shutdown
	 *   await maxim.cleanup();
	 * }
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
	 * @param name - Name of the test run
	 * @param inWorkspaceId - Workspace Id to create the test run in
	 * @returns Test run instance
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
		return createTestRunBuilder({
			baseUrl: this.baseUrl,
			apiKey: this.apiKey,
			name,
			workspaceId: inWorkspaceId,
			evaluators: [],
			isDebug: this.isDebug,
		});
	}

	/**
	 * Cleans up all SDK resources and prepares for application shutdown.
	 *
	 * This method performs essential cleanup operations including stopping sync intervals,
	 * flushing logger data, clearing caches, and destroying HTTP agents. It ensures proper
	 * resource deallocation and prevents memory leaks.
	 *
	 * @async
	 * @important **CRITICAL**: Always call this method before your application
	 * exits. Failure to do so may result in memory leaks, unflushed data, or
	 * hanging processes. This is especially important in production environments
	 * and long-running applications.
	 * @example
	 * // Basic cleanup on application shutdown
	 * process.on('SIGINT', async () => {
	 *   console.log('Shutting down gracefully...');
	 *   await maxim.cleanup();
	 *   process.exit(0);
	 * });
	 *
	 * @example
	 * // Cleanup in Express.js application
	 * process.on('SIGTERM', async () => {
	 *   console.log('SIGTERM received, shutting down...');
	 *   await maxim.cleanup();
	 *   server.close(() => {
	 *     process.exit(0);
	 *   });
	 * });
	 *
	 * @example
	 * // Cleanup in test suites
	 * afterAll(async () => {
	 *   await maxim.cleanup();
	 * });
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

async function executePromptWithLogging(
	parent: Trace | Span | undefined,
	generationConfig: Partial<Omit<GenerationConfig, "messages" | "provider" | "model" | "modelParameters">> | undefined,
	deployedVersion: PromptVersion,
	options: { imageUrls?: ImageUrl[]; variables?: { [key: string]: string } } | undefined,
	executor: () => Promise<PromptResponse>,
): Promise<PromptResponse> {
	if (!parent) {
		return executor();
	}

	const generationId = generationConfig?.id || uniqueId();
	let resolvedMessages: (CompletionRequest | ChatCompletionMessage)[] = [];

	const generation = parent.generation({
		id: generationId,
		model: deployedVersion.config?.model || "",
		provider: (deployedVersion.config?.provider || "") as any,
		messages: resolvedMessages,
		modelParameters: deployedVersion.config?.modelParameters || {},
		...generationConfig,
	});

	try {
		const result = await executor();

		resolvedMessages = result.resolvedMessages || [];
		if (resolvedMessages && resolvedMessages.length > 0 && "payload" in (resolvedMessages[0] as any)) {
			resolvedMessages = resolvedMessages.map((m: any) => m.payload);
		}

		generation.addMessages(resolvedMessages);

		if (options?.variables) {
			generation.addMetadata({ ...options.variables });
		}

		const logResult: ChatCompletionResult = {
			id: result.id,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: result.model,
			choices: result.choices.map((c) => ({
				index: c.index,
				message: c.message,
				logprobs: null,
				finish_reason: c.finishReason,
			})),
			usage: {
				prompt_tokens: result.usage.promptTokens,
				completion_tokens: result.usage.completionTokens,
				total_tokens: result.usage.totalTokens,
			},
		};

		generation.result(logResult);
		return result;
	} catch (e: any) {
		generation.error({
			message: e.message,
			code: e.code,
		});

		throw e;
	}
}
