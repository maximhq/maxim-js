#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

/**
 * Post-process MDX files to fix front-matter placeholders
 */
function fixFrontMatter() {
	const docsDir = path.join(__dirname, "..", "docs");

	if (!fs.existsSync(docsDir)) {
		console.log("No docs directory found");
		return;
	}

	// Recursively process all .mdx files
	function processDirectory(dir) {
		const files = fs.readdirSync(dir);

		for (const file of files) {
			const filePath = path.join(dir, file);
			const stat = fs.statSync(filePath);

			if (stat.isDirectory()) {
				processDirectory(filePath);
			} else if (file.endsWith(".mdx")) {
				processFile(filePath);
			}
		}
	}

	function processFile(filePath) {
		const content = fs.readFileSync(filePath, "utf8");
		const relativePath = path.relative(docsDir, filePath);

		// Generate a proper title from the file path
		const fileName = path.basename(filePath, ".mdx");
		const dirName = path.dirname(relativePath);

		let title = fileName;
		if (fileName === "index" || fileName === "overview") {
			title = dirName === "." ? "@maximai/maxim-js" : dirName;
		}

		// Replace placeholder with actual title
		const updatedContent = content.replace('title: "%name%"', `title: "${title}"`);

		if (content !== updatedContent) {
			fs.writeFileSync(filePath, updatedContent);
			console.log(`Fixed front-matter in: ${relativePath}`);
		}
	}

	processDirectory(docsDir);
	console.log("✅ Post-processing complete");
}

if (require.main === module) {
	fixFrontMatter();
}

module.exports = { fixFrontMatter };
