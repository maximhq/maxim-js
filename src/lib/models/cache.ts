import { PromptVersionsAndRules } from "./prompt";

/**
 * Type alias representing an entry stored in the Maxim cache.
 *
 * Currently aliases PromptVersionsAndRules, which contains prompt configurations,
 * deployment rules, and version information. This type may be extended in the
 * future to support additional cache entry types.
 *
 * @see {@link PromptVersionsAndRules} For the full structure of cached prompt data
 */
export type CacheEntry = PromptVersionsAndRules;
