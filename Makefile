# Makefile for Maxim AI JS SDK

# Variables
PACKAGE_NAME := @maximai/maxim-js
DIST_DIR := dist
NODE_MODULES := node_modules

# Default target
.DEFAULT_GOAL := help

# Help target
.PHONY: help
help:
	@echo "Available targets:"
	@echo "  install     - Install dependencies"
	@echo "  clean       - Remove build artifacts"
	@echo "  lint        - Run ESLint"
	@echo "  test        - Run tests"
	@echo "  test-ci     - Run tests (ignore failures for missing config)"
	@echo "  build       - Build the library (with TypeScript optimization)"
	@echo "  publish     - Publish to npm (usage: make publish VERSION=1.0.0)"
	@echo "  dev         - Development mode (install + build)"
	@echo "  ci          - CI pipeline (install + lint + test-ci + build)"
	@echo "  deps-check  - Check for outdated dependencies"
	@echo "  audit       - Run security audit"
	@echo "  audit-fix   - Fix security vulnerabilities"
	@echo "  help        - Show this help message"

# Install dependencies
.PHONY: install
install:
	@echo "Installing dependencies..."
	npm install

# Clean build artifacts
.PHONY: clean
clean:
	@echo "Cleaning build artifacts..."
	rm -rf $(DIST_DIR)

# Lint code
.PHONY: lint
lint:
	@echo "Running ESLint..."
	npm run lint

# Run tests
.PHONY: test
test:
	@echo "Running tests..."
	npm run test

# Run tests in CI mode (ignore failures for missing config)
.PHONY: test-ci
test-ci:
	@echo "Running tests in CI mode..."
	-npm run test

# Copy assets to dist
.PHONY: copy-assets
copy-assets:
	@echo "Copying assets..."
	npm run copy-assets

# Build the library
.PHONY: build
build: clean
	@echo "Building library..."
	npm run build

# Publish to npm
.PHONY: publish
publish: build
	@echo "Publishing to npm..."
	@if [ -z "$(VERSION)" ]; then \
		echo "Error: VERSION is required. Usage: make publish VERSION=1.0.0"; \
		exit 1; \
	fi
	node publish.mjs $(PACKAGE_NAME) $(VERSION)

# Development mode
.PHONY: dev
dev: install build

# CI pipeline
.PHONY: ci
ci: install lint test-ci build

# Watch mode for development (if you add a watch script later)
.PHONY: watch
watch:
	@echo "Starting watch mode..."
	@if npm run | grep -q "watch"; then \
		npm run watch; \
	else \
		echo "No watch script found. Consider adding one to package.json"; \
	fi

# Dependency check
.PHONY: deps-check
deps-check:
	@echo "Checking for outdated dependencies..."
	npm outdated

# Security audit
.PHONY: audit
audit:
	@echo "Running security audit..."
	npm audit

# Fix security vulnerabilities
.PHONY: audit-fix
audit-fix:
	@echo "Fixing security vulnerabilities..."
	npm audit fix

# Check if dist directory exists
$(DIST_DIR):
	@mkdir -p $(DIST_DIR)

# Ensure node_modules exists
$(NODE_MODULES):
	@$(MAKE) install 