/**
 * Metro configuration for React Native projects using @maximai/maxim-js
 *
 * This configuration helps Metro resolve platform-specific modules correctly.
 * Add this to your Metro config or merge with existing configuration.
 */

const { getDefaultConfig } = require("@react-native/metro-config");

/**
 * Get Maxim SDK Metro configuration
 * @param {object} existingConfig - Existing Metro configuration to merge with
 * @returns {object} Metro configuration
 */
function getMaximSDKMetroConfig(existingConfig = {}) {
	const defaultConfig = getDefaultConfig(__dirname);

	return {
		...defaultConfig,
		...existingConfig,
		resolver: {
			...defaultConfig.resolver,
			...existingConfig.resolver,
			extraNodeModules: {
				...(defaultConfig.resolver?.extraNodeModules || {}),
				...(existingConfig.resolver?.extraNodeModules || {}),
				...(tryResolve("expo-crypto") ? { crypto: tryResolve("expo-crypto") } : {}),
				...(tryResolve("readable-stream") ? { stream: tryResolve("readable-stream") } : {}),
			},
			resolverMainFields: ["react-native", "browser", "main", ...(existingConfig.resolver?.resolverMainFields || [])],
			platforms: ["native", "android", "ios", "react-native", "web", ...(existingConfig.resolver?.platforms || [])],
		},
		transformer: {
			...defaultConfig.transformer,
			...existingConfig.transformer,
			getTransformOptions: async () => ({
				transform: {
					experimentalImportSupport: false,
					inlineRequires: true,
				},
			}),
		},
	};
}

module.exports = getMaximSDKMetroConfig;
