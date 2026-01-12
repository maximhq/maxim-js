/**
 * This is a minimal script to publish your package to "npm".
 * This is meant to be used as-is or customize as you see fit.
 *
 * This script is executed on "dist/path/to/library" as "cwd" by default.
 *
 * You might need to authenticate with NPM before running this script.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function invariant(condition, message) {
	if (!condition) {
		console.error(message);
		process.exit(1);
	}
}

// Executing publish script: node path/to/publish.mjs {name} {version} [--otp=CODE] [--auth-type=web]
// Publishes the package and tags as 'latest' for stable releases.
// Use --auth-type=web for security key authentication (e.g., YubiKey)
const [, , name, version, ...rest] = process.argv;

// Parse optional --otp flag
const otpArg = rest.find(arg => arg.startsWith('--otp='));
const otp = otpArg ? otpArg.split('=')[1] : null;

// Parse optional --auth-type flag (use 'web' for security key)
const authTypeArg = rest.find(arg => arg.startsWith('--auth-type='));
const authType = authTypeArg ? authTypeArg.split('=')[1] : null;

// A simple SemVer validation to validate the version
const validVersion = /^(\d+\.){2}\d+(-[0-9A-Za-z-.]+)?$/;

invariant(
	version && validVersion.test(version),
	`No version provided or version did not match Semantic Versioning, expected: #.#.#-tag.# or #.#.#, got ${version}.`,
);

// Use the dist directory directly
const outputPath = join(__dirname, "dist");
invariant(existsSync(outputPath), `Build output directory "${outputPath}" does not exist. Please run the build first.`);

process.chdir(outputPath);

// Updating the version in "package.json" before publishing
try {
	const json = JSON.parse(readFileSync(`package.json`).toString());
	json.version = version;
	writeFileSync(`package.json`, JSON.stringify(json, null, 2));
} catch (e) {
	console.error(`Error reading package.json file from library build output.`);
}

// Execute "npm publish" to publish
// Build auth flags: prefer auth-type for security keys, otherwise use otp
let authFlags = '';
if (authType) {
	authFlags = ` --auth-type=${authType}`;
} else if (otp) {
	authFlags = ` --otp=${otp}`;
}

execSync(`npm publish --access public${authFlags}`, { stdio: 'inherit' });

// Tag as 'latest' if it's not a pre-release version
if (!version.includes('-')) {
	console.log(`Tagging version ${version} as 'latest'...`);
	execSync(`npm dist-tag add @maximai/maxim-js@${version} latest${authFlags}`, { stdio: 'inherit' });
} else {
	console.log(`Pre-release version ${version} published without 'latest' tag.`);
}