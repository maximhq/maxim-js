#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

/**
 * Generate Mintlify navigation structure for TypeScript SDK Reference documentation
 */
function generateMintlifyNav() {
	const docsDir = path.join(__dirname, "..", "docs");

	if (!fs.existsSync(docsDir)) {
		console.error("No docs directory found. Please run npm run docs:build first.");
		process.exit(1);
	}

	const navigation = {
		group: "Reference",
		pages: [],
	};

	// Add main overview files with clearer names
	const mainOverviewPath = path.join(docsDir, "overview.mdx");
	const mainIndexPath = path.join(docsDir, "index.mdx");
	if (fs.existsSync(mainOverviewPath)) {
		navigation.pages.push("sdk/typescript/reference/overview");
	} else if (fs.existsSync(mainIndexPath)) {
		navigation.pages.push("sdk/typescript/reference/getting-started");
	}

	navigation.pages.push("sdk/typescript/reference/modules");

	// Check for langchain integration
	const langchainDir = path.join(docsDir, "langchain");
	if (fs.existsSync(langchainDir)) {
		// Look for overview.mdx or index.mdx in langchain
		const langchainOverviewPath = path.join(langchainDir, "overview.mdx");
		const langchainIndexPath = path.join(langchainDir, "index.mdx");
		if (fs.existsSync(langchainOverviewPath)) {
			navigation.pages.push("sdk/typescript/reference/langchain/overview");
		} else if (fs.existsSync(langchainIndexPath)) {
			navigation.pages.push("sdk/typescript/reference/langchain/getting-started");
		}

		// Add langchain classes if they exist
		const langchainClassesDir = path.join(langchainDir, "classes");
		if (fs.existsSync(langchainClassesDir)) {
			const langchainClasses = fs
				.readdirSync(langchainClassesDir)
				.filter((file) => file.endsWith(".mdx"))
				.map((file) => file.replace(".mdx", ""))
				.sort();

			if (langchainClasses.length > 0) {
				navigation.pages.push({
					group: "LangChain",
					pages: langchainClasses.map((className) => `sdk/typescript/reference/langchain/classes/${className}`),
				});
			}
		}
	}

	// Process main core directory (renamed from index to avoid conflicts)
	const coreDir = path.join(docsDir, "core");
	if (fs.existsSync(coreDir)) {
		// Add main module overview with clearer name
		const coreOverviewPath = path.join(coreDir, "overview.mdx");
		const coreIndexPath = path.join(coreDir, "index.mdx");
		if (fs.existsSync(coreOverviewPath)) {
			navigation.pages.push("sdk/typescript/reference/core/overview");
		} else if (fs.existsSync(coreIndexPath)) {
			navigation.pages.push("sdk/typescript/reference/core/getting-started");
		}

		// Add Classes
		const classesDir = path.join(coreDir, "classes");
		if (fs.existsSync(classesDir)) {
			const classes = fs
				.readdirSync(classesDir)
				.filter((file) => file.endsWith(".mdx"))
				.map((file) => file.replace(".mdx", ""))
				.sort();

			if (classes.length > 0) {
				navigation.pages.push({
					group: "Classes",
					pages: classes.map((className) => `sdk/typescript/reference/core/classes/${className}`),
				});
			}
		}

		// Add Interfaces
		const interfacesDir = path.join(coreDir, "interfaces");
		if (fs.existsSync(interfacesDir)) {
			const interfaces = fs
				.readdirSync(interfacesDir)
				.filter((file) => file.endsWith(".mdx"))
				.map((file) => file.replace(".mdx", ""))
				.sort();

			if (interfaces.length > 0) {
				navigation.pages.push({
					group: "Interfaces",
					pages: interfaces.map((interfaceName) => `sdk/typescript/reference/core/interfaces/${interfaceName}`),
				});
			}
		}

		// Add Enumerations
		const enumsDir = path.join(coreDir, "enumerations");
		if (fs.existsSync(enumsDir)) {
			const enums = fs
				.readdirSync(enumsDir)
				.filter((file) => file.endsWith(".mdx"))
				.map((file) => file.replace(".mdx", ""))
				.sort();

			if (enums.length > 0) {
				navigation.pages.push({
					group: "Enumerations",
					pages: enums.map((enumName) => `sdk/typescript/reference/core/enumerations/${enumName}`),
				});
			}
		}

		// Add Type Aliases (if any)
		const typesDir = path.join(coreDir, "type-aliases");
		if (fs.existsSync(typesDir)) {
			const types = fs
				.readdirSync(typesDir)
				.filter((file) => file.endsWith(".mdx"))
				.map((file) => file.replace(".mdx", ""))
				.sort();

			if (types.length > 0) {
				navigation.pages.push({
					group: "Type Aliases",
					pages: types.map((typeName) => `sdk/typescript/reference/core/type-aliases/${typeName}`),
				});
			}
		}

		// Add Variables (if any)
		const variablesDir = path.join(coreDir, "variables");
		if (fs.existsSync(variablesDir)) {
			const variables = fs
				.readdirSync(variablesDir)
				.filter((file) => file.endsWith(".mdx"))
				.map((file) => file.replace(".mdx", ""))
				.sort();

			if (variables.length > 0) {
				navigation.pages.push({
					group: "Variables",
					pages: variables.map((varName) => `sdk/typescript/reference/core/variables/${varName}`),
				});
			}
		}

		// Add Functions (if any)
		const functionsDir = path.join(coreDir, "functions");
		if (fs.existsSync(functionsDir)) {
			const functions = fs
				.readdirSync(functionsDir)
				.filter((file) => file.endsWith(".mdx"))
				.map((file) => file.replace(".mdx", ""))
				.sort();

			if (functions.length > 0) {
				navigation.pages.push({
					group: "Functions",
					pages: functions.map((funcName) => `sdk/typescript/reference/core/functions/${funcName}`),
				});
			}
		}
	}

	// Create the complete docs.json structure for easy copy-paste
	const docsJson = {
		$schema: "Mintlify TypeScript SDK Reference Navigation",
		description: "Copy the 'reference' group below and paste it into your main docs.json under SDK > groups",
		reference: navigation,
	};

	// Write the navigation file
	const outputPath = path.join(__dirname, "..", "docs", "docs.json");
	fs.writeFileSync(outputPath, JSON.stringify(docsJson, null, 2));

	console.log("✅ Generated Mintlify navigation structure");
	console.log(`📁 Output: ${outputPath}`);
	console.log("\n🔥 Copy-paste instructions:");
	console.log("1. Open the generated docs/docs.json file");
	console.log("2. Copy the entire 'reference' object");
	console.log("3. Replace the existing Reference group in your main docs.json");
	console.log("\n📊 Statistics:");

	// Count items for summary
	let totalPages = 0;
	let groupCount = 0;

	function countPages(pages) {
		for (const page of pages) {
			if (typeof page === "string") {
				totalPages++;
			} else if (page.pages) {
				groupCount++;
				countPages(page.pages);
			}
		}
	}

	countPages(navigation.pages);
	console.log(`   - ${groupCount} groups`);
	console.log(`   - ${totalPages} total pages`);
	console.log("\n🎯 Mintlify-friendly paths used:");
	console.log("   - /sdk/typescript/reference/overview (or getting-started)");
	console.log("   - /sdk/typescript/reference/core/* (instead of index/*)");
	console.log("   - /sdk/typescript/reference/langchain/* for integrations");
}

if (require.main === module) {
	generateMintlifyNav();
}

module.exports = { generateMintlifyNav };
