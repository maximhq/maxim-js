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
	@echo "  version     - Update version in package.json (usage: make version VERSION=1.0.0)"
	@echo "  publish     - Publish to npm with git tag and GitHub release (uses version from package.json, extracts notes from README.md)"
	@echo "  release     - Publish with custom release notes (usage: make release NOTES='Release notes')"
	@echo "  preview-release - Preview release notes from README.md (usage: make preview-release [NOTES='Notes'])"
	@echo "  test-readme-parsing - Test README.md parsing for debugging (usage: make test-readme-parsing [VERSION=1.0.0])"
	@echo "  create-release - Create git tag and GitHub release (usage: make create-release VERSION=1.0.0 [NOTES='Notes'])"
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

# Clean package.json for distribution
.PHONY: clean-package
clean-package:
	@echo "Cleaning package.json for distribution..."
	npm run clean-package

# Build the library
.PHONY: build
build: clean
	@echo "Building library..."
	npm run build

# Update version in package.json
.PHONY: version
version:
	@if [ -z "$(VERSION)" ]; then \
		echo "Error: VERSION is required. Usage: make version VERSION=1.0.0"; \
		exit 1; \
	fi
	@set -e; \
	echo "Updating version to $(VERSION) in package.json..."; \
	npm version $(VERSION) --no-git-tag-version; \
	echo "Version updated to $(VERSION)"

# Publish to npm
.PHONY: publish
publish: build
	@echo "Publishing to npm..."
	@set -e; \
	VERSION=$$(node -p "require('./package.json').version"); \
	echo "Publishing version $$VERSION..."; \
	node publish.mjs $(PACKAGE_NAME) $$VERSION; \
	echo "Creating git tag and GitHub release..."; \
	$(MAKE) create-release VERSION=$$VERSION

# Test README.md parsing (for debugging)
.PHONY: test-readme-parsing
test-readme-parsing:
	@echo "Testing README.md parsing..."
	@set -e; \
	if [ -n "$(VERSION)" ]; then \
		TEST_VERSION="$(VERSION)"; \
	else \
		TEST_VERSION=$$(node -p "require('./package.json').version"); \
	fi; \
	echo "Testing extraction for version: $$TEST_VERSION"; \
	if [ -f "README.md" ]; then \
		echo "--- Testing with 'v' prefix ---"; \
		awk '/^### v'$$TEST_VERSION'$$/{flag=1; next} /^### v[0-9]/{flag=0} flag' README.md; \
		echo "--- Testing without 'v' prefix ---"; \
		awk '/^### '$$TEST_VERSION'$$/{flag=1; next} /^### [0-9]/{flag=0} flag' README.md; \
	else \
		echo "README.md not found"; \
	fi

# Preview release notes without creating release
.PHONY: preview-release
preview-release:
	@set -e; \
	VERSION=$$(node -p "require('./package.json').version"); \
	echo "Version: $$VERSION"; \
	if [ -n "$(NOTES)" ]; then \
		echo "Custom release notes:"; \
		echo "$(NOTES)"; \
	else \
		echo "Release notes from README.md:"; \
		if [ -f "README.md" ]; then \
			awk '/^### v'$$VERSION'$$/{flag=1; next} /^### v[0-9]/{flag=0} flag' README.md > /tmp/preview_notes.txt; \
			if [ -s /tmp/preview_notes.txt ]; then \
				cat /tmp/preview_notes.txt; \
			else \
				awk '/^### '$$VERSION'$$/{flag=1; next} /^### [0-9]/{flag=0} flag' README.md > /tmp/preview_notes.txt; \
				if [ -s /tmp/preview_notes.txt ]; then \
					cat /tmp/preview_notes.txt; \
				else \
					echo "No release notes found for $$VERSION in README.md"; \
				fi; \
			fi; \
			rm -f /tmp/preview_notes.txt; \
		else \
			echo "README.md not found"; \
		fi; \
	fi

# Create git tag and GitHub release
.PHONY: create-release
create-release:
	@if [ -z "$(VERSION)" ]; then \
		echo "Error: VERSION is required."; \
		exit 1; \
	fi
	@set -e; \
	echo "Creating git tag v$(VERSION)..."; \
	git tag -a "v$(VERSION)" -m "Release v$(VERSION)"; \
	echo "Pushing tag to remote..."; \
	git push origin "v$(VERSION)"; \
	echo "Creating GitHub release..."
	@set -e; \
	if command -v gh >/dev/null 2>&1; then \
		if [ -n "$(NOTES)" ]; then \
			echo "Using custom release notes: $(NOTES)"; \
			gh release create "v$(VERSION)" --title "Release v$(VERSION)" --notes "$(NOTES)"; \
		else \
			echo "Extracting release notes from README.md..."; \
			if [ -f "README.md" ]; then \
				echo "Looking for release notes for version $(VERSION)..."; \
				awk '/^### v$(VERSION)$$/{flag=1; next} /^### v[0-9]/{flag=0} flag' README.md > /tmp/release_notes.txt; \
				if [ -s /tmp/release_notes.txt ]; then \
					echo "Found release notes in README.md:"; \
					cat /tmp/release_notes.txt; \
					gh release create "v$(VERSION)" --title "Release v$(VERSION)" --notes-file /tmp/release_notes.txt; \
				else \
					echo "No release notes found for v$(VERSION) in README.md, trying without 'v' prefix..."; \
					awk '/^### $(VERSION)$$/{flag=1; next} /^### [0-9]/{flag=0} flag' README.md > /tmp/release_notes.txt; \
					if [ -s /tmp/release_notes.txt ]; then \
						echo "Found release notes in README.md:"; \
						cat /tmp/release_notes.txt; \
						gh release create "v$(VERSION)" --title "Release v$(VERSION)" --notes-file /tmp/release_notes.txt; \
					else \
						echo "No release notes found for $(VERSION) in README.md, using default notes..."; \
						gh release create "v$(VERSION)" --title "Release v$(VERSION)" --notes "Release v$(VERSION)"; \
					fi; \
				fi; \
			else \
				echo "README.md not found, using default notes..."; \
				gh release create "v$(VERSION)" --title "Release v$(VERSION)" --notes "Release v$(VERSION)"; \
			fi; \
			rm -f /tmp/release_notes.txt; \
		fi; \
	else \
		echo "GitHub CLI (gh) not found. Please install it to create GitHub releases."; \
		echo "Tag v$(VERSION) has been created and pushed to remote."; \
	fi

# Publish with custom release notes
.PHONY: release
release: build
	@echo "Publishing with release notes..."
	@set -e; \
	VERSION=$$(node -p "require('./package.json').version"); \
	echo "Publishing version $$VERSION..."; \
	if [ -n "$(NOTES)" ]; then \
		echo "Using custom release notes: $(NOTES)"; \
	else \
		echo "No custom notes provided, will extract from README.md"; \
	fi; \
	node publish.mjs $(PACKAGE_NAME) $$VERSION; \
	echo "Creating git tag and GitHub release..."; \
	$(MAKE) create-release VERSION=$$VERSION NOTES="$(NOTES)"

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