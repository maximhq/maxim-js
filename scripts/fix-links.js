#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

/**
 * Fix internal links in generated MDX files
 * - Remove .mdx extensions from links
 * - Change index/ paths to core/
 * - Fix all cases of path duplication (classes/classes, interfaces/interfaces, etc.)
 * - Handle proper relative pathing for subdirectories
 */
function fixLinks() {
	const docsDir = path.join(__dirname, "..", "docs");

	if (!fs.existsSync(docsDir)) {
		console.log("No docs directory found");
		return;
	}

	console.log("🔗 Fixing internal links for Mintlify compatibility...");

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

		let updatedContent = content;
		let hasChanges = false;

		// Analyze the file's location
		const pathParts = relativePath.split(path.sep);
		const currentDir = path.dirname(filePath);
		const currentDirName = path.basename(currentDir);
		const parentDirName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : null;

		// Define known subdirectory types that could have duplication issues
		const knownSubdirs = ["classes", "interfaces", "enumerations", "types", "functions", "variables", "modules", "langchain"];

		console.log(`Processing: ${relativePath}`);
		console.log(`  Current dir: ${currentDirName}`);
		console.log(`  Parent dir: ${parentDirName}`);

		// Fix markdown links: [text](path.mdx) -> [text](path)
		const mdxLinkRegex = /\[([^\]]*)\]\(([^)]*\.mdx[^)]*)\)/g;
		updatedContent = updatedContent.replace(mdxLinkRegex, (match, text, url) => {
			hasChanges = true;
			const newUrl = url.replace(/\.mdx/g, "");
			console.log(`    Fixed .mdx: ${url} -> ${newUrl}`);
			return `[${text}](${newUrl})`;
		});

		// Fix paths that reference index/ -> core/
		const indexPathRegex = /\/index\//g;
		if (indexPathRegex.test(updatedContent)) {
			updatedContent = updatedContent.replace(indexPathRegex, "/core/");
			hasChanges = true;
			console.log(`    Fixed index/ -> core/`);
		}

		// Fix relative paths that reference index/ -> core/
		const relativeIndexRegex = /(\[.*?\]\([^)]*?)index\//g;
		if (relativeIndexRegex.test(updatedContent)) {
			updatedContent = updatedContent.replace(relativeIndexRegex, (match, prefix) => {
				console.log(`    Fixed relative index/: ${match}`);
				return prefix + "core/";
			});
			hasChanges = true;
		}

		// Fix double core/ issue when we're already in core directory
		if (relativePath.replace(/\\/g, "/").startsWith("core/")) {
			const doubleCoreRegex = /\]\(\.\/core\//g;
			if (doubleCoreRegex.test(updatedContent)) {
				updatedContent = updatedContent.replace(doubleCoreRegex, "](./");
				hasChanges = true;
				console.log(`    Fixed core/core duplication`);
			}
		}

		// COMPREHENSIVE SUBDIRECTORY LINK FIXING
		// This handles proper cross-directory navigation for files in subdirectories

		if (knownSubdirs.includes(currentDirName)) {
			console.log(`    Fixing subdirectory links for: ${currentDirName}`);

			// Pattern 1: Fix same-directory links (./classes/Something -> ./Something for files in classes/)
			const sameDirRegex = new RegExp(`\\]\\(\\.\\/${currentDirName}\\/([^)]+)\\)`, "g");
			const sameDirMatches = [...updatedContent.matchAll(sameDirRegex)];
			if (sameDirMatches.length > 0) {
				updatedContent = updatedContent.replace(sameDirRegex, (match, fileName) => {
					console.log(`    Fixed same-dir: ${match} -> ](./${fileName})`);
					return `](./${fileName})`;
				});
				hasChanges = true;
			}

			// Pattern 2: Fix cross-directory links within core
			// For files in classes/, interfaces/, enumerations/, we need to fix links to other subdirectories

			// Fix links to classes from other subdirectories
			if (currentDirName !== "classes") {
				const classLinkRegex = /\]\(\.\/classes\/([^)]+)\)/g;
				const classMatches = [...updatedContent.matchAll(classLinkRegex)];
				if (classMatches.length > 0) {
					updatedContent = updatedContent.replace(classLinkRegex, (match, className) => {
						// If we're in langchain directory, don't redirect to core classes
						if (parentDirName === "langchain") {
							console.log(`    Fixed langchain classes: ${match} -> ](./classes/${className})`);
							return `](./classes/${className})`;
						} else {
							console.log(`    Fixed cross-dir to classes: ${match} -> ](../classes/${className})`);
							return `](../classes/${className})`;
						}
					});
					hasChanges = true;
				}
			}

			// Fix links to interfaces from other subdirectories
			if (currentDirName !== "interfaces") {
				const interfaceLinkRegex = /\]\(\.\/interfaces\/([^)]+)\)/g;
				const interfaceMatches = [...updatedContent.matchAll(interfaceLinkRegex)];
				if (interfaceMatches.length > 0) {
					updatedContent = updatedContent.replace(interfaceLinkRegex, (match, interfaceName) => {
						console.log(`    Fixed cross-dir to interfaces: ${match} -> ](../interfaces/${interfaceName})`);
						return `](../interfaces/${interfaceName})`;
					});
					hasChanges = true;
				}
			}

			// Fix links to enumerations from other subdirectories
			if (currentDirName !== "enumerations") {
				const enumLinkRegex = /\]\(\.\/enumerations\/([^)]+)\)/g;
				const enumMatches = [...updatedContent.matchAll(enumLinkRegex)];
				if (enumMatches.length > 0) {
					updatedContent = updatedContent.replace(enumLinkRegex, (match, enumName) => {
						console.log(`    Fixed cross-dir to enumerations: ${match} -> ](../enumerations/${enumName})`);
						return `](../enumerations/${enumName})`;
					});
					hasChanges = true;
				}
			}

			// Fix links to langchain from other subdirectories
			if (currentDirName !== "langchain") {
				const langchainLinkRegex = /\]\(\.\/langchain\/([^)]+)\)/g;
				const langchainMatches = [...updatedContent.matchAll(langchainLinkRegex)];
				if (langchainMatches.length > 0) {
					updatedContent = updatedContent.replace(langchainLinkRegex, (match, langchainPath) => {
						console.log(`    Fixed cross-dir to langchain: ${match} -> ](../langchain/${langchainPath})`);
						return `](../langchain/${langchainPath})`;
					});
					hasChanges = true;
				}
			}
		}

		// ADVANCED PATTERN MATCHING for any remaining nested directory duplication
		// Pattern: [text](./dirA/dirA/something) -> [text](./dirA/something)
		// Pattern: [text](./dirA/dirB/dirB/something) -> [text](./dirA/dirB/something)
		const nestedDuplicationRegex = /(\[.*?\]\([^)]*?)\/([^\/\)]+)\/\2\//g;
		const duplicateMatches = [...updatedContent.matchAll(nestedDuplicationRegex)];
		if (duplicateMatches.length > 0) {
			updatedContent = updatedContent.replace(nestedDuplicationRegex, (match, prefix, dirName) => {
				console.log(`    Fixed nested duplication: ${match} -> ${prefix}/${dirName}/`);
				return `${prefix}/${dirName}/`;
			});
			hasChanges = true;
		}

		// Fix specific cross-directory references for files in subdirectories
		const isInSubdir =
			currentDirName !== "docs" && currentDirName !== "core" && currentDirName !== "langchain" && parentDirName !== "langchain";

		if (isInSubdir) {
			// Fix links to modules from within subdirectories
			if (updatedContent.includes("](./modules)")) {
				updatedContent = updatedContent.replace(/\]\(\.\/modules\)/g, "](../../modules)");
				hasChanges = true;
				console.log(`    Fixed modules reference from subdirectory`);
			}

			// Fix links to overview from within subdirectories
			if (updatedContent.includes("](./overview")) {
				updatedContent = updatedContent.replace(/\]\(\.\/overview([^)]*)\)/g, "](../overview$1)");
				hasChanges = true;
				console.log(`    Fixed overview reference from subdirectory`);
			}
		}

		// Generic cleanup of remaining .mdx references
		const remainingMdxRegex = /\.mdx(?=[#\)])/g;
		if (remainingMdxRegex.test(updatedContent)) {
			updatedContent = updatedContent.replace(remainingMdxRegex, "");
			hasChanges = true;
			console.log(`    Cleaned up remaining .mdx references`);
		}

		// Write back if changes were made
		if (hasChanges) {
			fs.writeFileSync(filePath, updatedContent);
			console.log(`✅ Fixed links in: ${relativePath}`);
		} else {
			console.log(`  No changes needed for: ${relativePath}`);
		}
	}

	processDirectory(docsDir);
	console.log("✅ Link fixing complete");
}

if (require.main === module) {
	fixLinks();
}

module.exports = { fixLinks };
