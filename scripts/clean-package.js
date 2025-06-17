const fs = require("fs");
const path = require("path");

// Read the source package.json
const packagePath = path.join(__dirname, "..", "package.json");
const distPackagePath = path.join(__dirname, "..", "dist", "package.json");

// Read and parse the package.json
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

// Remove devDependencies
delete packageJson.devDependencies;

// Remove scripts that are only needed for development
const scriptsToRemove = ["lint", "test", "clean", "prebuild"];
if (packageJson.scripts) {
	scriptsToRemove.forEach((script) => {
		delete packageJson.scripts[script];
	});
}

// Write the cleaned package.json to dist
fs.writeFileSync(distPackagePath, JSON.stringify(packageJson, null, 2));

console.log("Cleaned package.json created in dist folder (removed devDependencies and dev scripts)");
