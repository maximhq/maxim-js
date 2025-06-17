#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

/**
 * Rename generated files to avoid Mintlify index path conflicts
 */
function renameFiles() {
	const docsDir = path.join(__dirname, "..", "docs");

	if (!fs.existsSync(docsDir)) {
		console.log("No docs directory found");
		return;
	}

	console.log("🔄 Renaming files for Mintlify compatibility...");

	// Create core directory and move index directory contents
	const indexDir = path.join(docsDir, "index");
	const coreDir = path.join(docsDir, "core");

	if (fs.existsSync(indexDir)) {
		// Create core directory
		if (!fs.existsSync(coreDir)) {
			fs.mkdirSync(coreDir, { recursive: true });
		}

		// Move all contents from index to core
		const files = fs.readdirSync(indexDir);
		for (const file of files) {
			const sourcePath = path.join(indexDir, file);
			const destPath = path.join(coreDir, file);

			if (fs.existsSync(destPath)) {
				// Remove existing destination
				if (fs.statSync(destPath).isDirectory()) {
					fs.rmSync(destPath, { recursive: true, force: true });
				} else {
					fs.unlinkSync(destPath);
				}
			}

			fs.renameSync(sourcePath, destPath);
		}

		// Remove empty index directory
		fs.rmSync(indexDir, { recursive: true, force: true });
		console.log("✅ Moved index/ → core/");
	}

	// Rename main index.mdx to overview.mdx if it exists
	const mainIndexPath = path.join(docsDir, "index.mdx");
	const mainOverviewPath = path.join(docsDir, "overview.mdx");
	if (fs.existsSync(mainIndexPath) && !fs.existsSync(mainOverviewPath)) {
		fs.renameSync(mainIndexPath, mainOverviewPath);
		console.log("✅ Renamed index.mdx → overview.mdx");
	}

	// Rename langchain index.mdx to overview.mdx if it exists
	const langchainDir = path.join(docsDir, "langchain");
	if (fs.existsSync(langchainDir)) {
		const langchainIndexPath = path.join(langchainDir, "index.mdx");
		const langchainOverviewPath = path.join(langchainDir, "overview.mdx");
		if (fs.existsSync(langchainIndexPath) && !fs.existsSync(langchainOverviewPath)) {
			fs.renameSync(langchainIndexPath, langchainOverviewPath);
			console.log("✅ Renamed langchain/index.mdx → langchain/overview.mdx");
		}
	}

	// Rename core/index.mdx to core/overview.mdx if it exists
	if (fs.existsSync(coreDir)) {
		const coreIndexPath = path.join(coreDir, "index.mdx");
		const coreOverviewPath = path.join(coreDir, "overview.mdx");
		if (fs.existsSync(coreIndexPath) && !fs.existsSync(coreOverviewPath)) {
			fs.renameSync(coreIndexPath, coreOverviewPath);
			console.log("✅ Renamed core/index.mdx → core/overview.mdx");
		}
	}

	console.log("✅ File renaming complete");
}

if (require.main === module) {
	renameFiles();
}

module.exports = { renameFiles };
