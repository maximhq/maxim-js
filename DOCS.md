# Documentation Generation

This project uses TypeDoc with markdown plugins to automatically generate MDX documentation from TypeScript source code and JSDoc comments.

## Overview

The documentation workflow converts TypeScript code with JSDoc/TSDoc comments into ready-to-publish MDX files suitable for documentation sites like Docusaurus or Astro Starlight.

## Setup

### Dependencies

The following dev dependencies are installed for documentation generation:

- `typedoc` - Core TypeScript documentation generator
- `typedoc-plugin-markdown` - Generates Markdown instead of HTML
- `typedoc-plugin-frontmatter` - Adds YAML front-matter to files

### Configuration

Documentation generation is configured via:

- `typedoc.json` - TypeDoc configuration file
- `scripts/post-docs.js` - Post-processing script to fix front-matter placeholders

## Usage

### Generate Documentation

```bash
# Clean, generate, and post-process documentation (includes Mintlify nav)
npm run docs:build

# Or run individual steps:
npm run docs:clean        # Remove existing docs
npm run docs:generate     # Generate MDX files
npm run docs:rename       # Rename files for Mintlify compatibility
npm run docs:fix-links    # Fix internal links for Mintlify
npm run docs:post-process # Fix front-matter placeholders
npm run docs:mintlify     # Generate Mintlify navigation structure
```

### Output

Generated documentation is placed in:

- `docs/api/` - Main API documentation with MDX files
- `docs/docs.json` - Mintlify navigation structure for copy-paste
- Individual `.mdx` files for classes, interfaces, enums, etc.
- Proper YAML front-matter for site generators

## Integration with Mintlify

The workflow automatically generates a `docs/docs.json` file with the complete TypeScript SDK navigation structure. It uses Mintlify-friendly paths that avoid index conflicts:

- `sdk/typescript/reference/overview` - Main API overview
- `sdk/typescript/reference/core/*` - Core API classes, interfaces, enums (instead of problematic `index/*`)
- `sdk/typescript/reference/langchain/*` - LangChain integration

Simply:

1. Run `npm run docs:build`
2. Open `docs/docs.json`
3. Copy the entire `typescript` object
4. Paste it into your main Mintlify `docs.json` file under `navigation > tabs > SDK > groups > Typescript > pages`

## Build Exclusions

Documentation files are excluded from the package build via:

- `.gitignore` - Excludes `docs/` from version control
- `.npmignore` - Excludes documentation files from published package
- No references in build scripts or TypeScript configurations

## Warnings and Errors

The generation process may show warnings about:

- Missing type references
- Unresolved links

These warnings don't affect the generated documentation quality.
