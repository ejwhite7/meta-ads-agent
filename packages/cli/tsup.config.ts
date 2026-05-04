/**
 * @file tsup.config.ts
 *
 * Build configuration for the publishable `meta-ads-agent` CLI.
 *
 * What this does:
 *   - Bundles the CLI plus the workspace-internal `@meta-ads-agent/core`
 *     and `@meta-ads-agent/meta-client` packages into a single ESM file
 *     so npm consumers don't need any private workspace packages on the
 *     registry.
 *   - Keeps every other npm dependency external (they're real npm deps
 *     declared in this package's package.json and resolved at install
 *     time on the user's machine). Bundling them would either bloat the
 *     artifact, break native modules (better-sqlite3, pg), or break
 *     dynamic-require-based libraries (winston, drizzle-orm).
 *   - Preserves the `#!/usr/bin/env node` shebang so the published `bin`
 *     entry executes directly.
 *   - Emits ESM only because the entire workspace is "type": "module".
 */

import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "node20",
	platform: "node",

	/* Inline only the workspace packages; everything else stays a runtime dep. */
	noExternal: ["@meta-ads-agent/core", "@meta-ads-agent/meta-client"],

	/* Native modules and runtime deps must NOT be bundled. better-sqlite3 / pg
	 * have native bindings; winston and drizzle-orm rely on dynamic requires. */
	external: [
		"better-sqlite3",
		"pg",
		"pg-native",
		"@anthropic-ai/sdk",
		"openai",
		/* drizzle-orm publishes deep subpath exports (sqlite-core, node-postgres,
		 * better-sqlite3, etc.). A single regex keeps any current or future
		 * subpath external. */
		/^drizzle-orm(\/.*)?$/,
		"hono",
		/* hono publishes deep subpaths (cors, logger, jsx, etc.). */
		/^hono(\/.*)?$/,
		/^@hono\/node-server(\/.*)?$/,
		"axios",
		"zod",
		"dotenv",
		/^@sinclair\/typebox(\/.*)?$/,
		"chalk",
		"commander",
		"inquirer",
		"ora",
		"boxen",
		"cli-table3",
		"winston",
	],

	clean: true,
	/* Source maps inflate the published tarball ~3x without helping users
	 * (they install via npm; if they need to debug, they clone the repo).
	 * Re-enable for local development by setting TSUP_SOURCEMAP=true. */
	sourcemap: process.env.TSUP_SOURCEMAP === "true",
	splitting: false,
	dts: false /* The published CLI has no library API surface. */,
	shims: false,
	skipNodeModulesBundle: true,
	banner: { js: "#!/usr/bin/env node" },

	/* Make the output executable so `bin: dist/index.js` works post-install. */
	onSuccess: "chmod +x dist/index.js",
});
