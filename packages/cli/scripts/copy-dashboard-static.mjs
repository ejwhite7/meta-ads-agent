#!/usr/bin/env node
/**
 * Copies the built dashboard static assets from
 * `packages/dashboard/dist/` into `packages/cli/dashboard-static/` so
 * they ship inside the published `meta-ads-agent` npm tarball.
 *
 * The CLI's `dashboard` command resolves these assets at runtime via
 * `import.meta.url` (see src/commands/dashboard.ts:resolveStaticDir).
 *
 * Run as part of `pnpm --filter meta-ads-agent build` so we never
 * publish a stale snapshot. If the dashboard hasn't been built yet,
 * we fail loudly rather than ship an empty directory.
 */
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(__dirname, "..");
const dashboardDist = resolve(cliRoot, "..", "dashboard", "dist");
const target = resolve(cliRoot, "dashboard-static");

if (!existsSync(dashboardDist)) {
	console.error(
		`[copy-dashboard-static] No dashboard build found at:\n  ${dashboardDist}\n\n` +
			"Run `pnpm --filter @meta-ads-agent/dashboard build` first.\n" +
			"(`pnpm build` from the repo root does this automatically.)",
	);
	process.exit(1);
}

if (!existsSync(resolve(dashboardDist, "index.html"))) {
	console.error(
		`[copy-dashboard-static] Dashboard build at ${dashboardDist} is missing index.html.`,
	);
	process.exit(1);
}

/* Wipe any stale copy so removed files don't linger. */
if (existsSync(target)) {
	rmSync(target, { recursive: true, force: true });
}
mkdirSync(target, { recursive: true });

cpSync(dashboardDist, target, { recursive: true });

const files = readdirSync(target);
console.log(
	`[copy-dashboard-static] Copied ${files.length} top-level entr${files.length === 1 ? "y" : "ies"} into dashboard-static/`,
);
