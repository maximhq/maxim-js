module.exports = {
	testEnvironment: "node",
	displayName: "maxim-js",
	preset: "ts-jest",
	coverageDirectory: "./coverage",
	testMatch: ["**/src/**/*.spec.ts", "**/src/**/*.test.ts"],
	moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
	collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts", "!src/**/*.spec.ts", "!src/**/*.test.ts"],
	clearMocks: true,
};
