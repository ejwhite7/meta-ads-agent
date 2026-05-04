---
name: meta-ads-agent
description: Use when working on the meta-ads-agent codebase — autonomous Meta (Facebook/Instagram) ads agent, TypeScript pnpm/Turborepo monorepo, four packages (core / meta-client / cli / dashboard). Covers per-campaign goals, OODA loop, outcome backfill, snapshot writer, direct Marketing API integration, schema bootstrapping, dashboard bundling. Triggered by file paths under `packages/{core,meta-client,cli,dashboard}`, mentions of `MetaClient`, `AgentSession`, `BackfillEngine`, `CampaignGoalRepository`, `AuditLogger`, or commands like `meta-ads-agent run` / `guidance` / `dashboard` / `decisions`.
---

# meta-ads-agent

When you're working on this codebase, follow these conventions before reaching for general best practices. They reflect decisions captured in [DESIGN.md](DESIGN.md) — there's almost certainly a previously-considered tradeoff behind anything that looks weird.

## Always do first

1. **Read [AGENTS.md](AGENTS.md)** for project shape, common commands, code conventions, and gotchas. It's optimized for a fresh thread.
2. **Run `pnpm format && pnpm typecheck && pnpm test && pnpm lint && pnpm build`** before pushing. CI runs all five; any failure blocks merge.
3. **For non-trivial changes, write a thorough commit message and PR body.** Match the level of detail in recent PRs (#19, #21, #22, #23). State the problem, the chosen approach, what was rejected, and verification.

## Architecture facts (so you don't have to re-derive)

- **Direct Marketing API only.** No Python CLI wrapper. `axios` to `graph.facebook.com/v21.0`. See [DESIGN.md §1](DESIGN.md).
- **Four packages, one publishable artifact.** `core` and `meta-client` are bundled into `cli` via `tsup`; `dashboard` ships as static assets in the same tarball. There is no public API contract for `core` or `meta-client`.
- **`~/.meta-ads-agent/`** is the canonical state dir: `config.json`, `agent.db`, `agent.sock`, `daemon.json`. Don't write to `./data/`.
- **SQLite default** is auto-bootstrapped on every connection via inlined SQL (no migration runner ships in the bundle). Three phases: tables → ALTER → indexes.
- **Audit log is the system of record.** Three consecutive failures and the session halts itself. Do not bypass.
- **Per-campaign goals required.** Agent refuses to act on a campaign without an active goal in `campaign_goals`. Configure via `meta-ads-agent guidance` or the `init` wizard. See [DESIGN.md §2, §3](DESIGN.md).
- **Backfill engine runs before the OODA loop**, not after. So the LLM sees recently-graded decisions when it reasons. See [DESIGN.md §5](DESIGN.md).
- **Snapshot writer + audit log are separate tables.** Don't conflate. See [DESIGN.md §4](DESIGN.md).

## File conventions

- **Tools** are factory functions returning frozen `createTool({...})` objects, with TypeBox schemas for `parameters`. They accept an optional `MetaClient | null` so they work both bound and via `context.metaClient` (see `tools/budget/_client.ts:resolveMetaClient`).
- **Drizzle schema lives in one place**: `packages/core/src/db/schema.ts`. Schema changes require updating `bootstrap.ts` (the inlined SQL) AND adding a `.sql` migration file under `db/migrations/`. New columns referenced by an index must go in the ALTER block, with the index in the INDEXES block — not the TABLES block.
- **`AuditRecord` field names match the Drizzle schema's TS field names exactly** (`reasoning`, `params`, `expectedOutcome`, `success`, etc.) — NOT the legacy aspirational shape (`llmReasoning`, `toolParams`, `status`). The dashboard's frontend reads these verbatim.
- **`CampaignGoalRepository.getActive`** has subtle logic: select most-recent row regardless of `deletedAt`, THEN check that row's `deletedAt`. Don't replace with `WHERE deletedAt IS NULL ORDER BY ... LIMIT 1` — that returns the wrong row when a tombstone exists. Test coverage exists; if you replicate the logic elsewhere, port the test.

## Things to never do

- **Hardcode an account-wide ROAS or CPA target.** Goals are per-campaign. The legacy `AgentGoal.roasTarget` / `cpaCap` fields exist for backwards compat but should not drive new logic.
- **Log secrets.** No tokens, no API keys. Be careful what gets stuffed into `params` for audit-logged tools.
- **`writeFileSync` a secrets file without `mode: 0o600` AND unlinking the existing file first.** Mode is ignored on existing files. See `init.ts`.
- **Replace `timingSafeEqual` with `!==`** for the dashboard API key. Dashboard auth fails closed by design.
- **Add `{}` placeholder objects cast to a class type** (e.g. `{} as MetaClient`). PR #8 fixed exactly this pattern across the budget tools — every method call exploded at runtime. Use `null` and resolve from context.

## Common gotchas (compressed)

| Symptom | Cause |
|---|---|
| `Cannot find module '.../core/dist/index.js'` | CLI run before `pnpm build` — `pnpm cli` auto-builds |
| `no such table: agent_decisions` | Wrong sqlitePath, or bootstrap path was bypassed |
| `no such column: actual_outcome` | Index was created before ALTER ran (3-phase bootstrap not respected) |
| Dashboard `Cannot read properties of undefined (reading 'length')` | Frontend type doesn't match backend `AuditRecord` shape |
| Daemon logs `IPC server listening on %s` literally | Winston `splat()` format missing — already wired; don't regress |
| `(#200) Ad account owner has NOT grant ads_management` | Token's granular scopes don't include this account → regenerate |
| `pnpm --filter X server` fails with "Unknown option: 'recursive'" | Missing `run` keyword on pnpm 9+: `pnpm --filter X run server` |

## Cross-references

- **[CLAUDE.md](CLAUDE.md)** — exhaustive architectural reference.
- **[DESIGN.md](DESIGN.md)** — decision rationale; rejected alternatives.
- **[AGENTS.md](AGENTS.md)** — quick orientation for fresh threads.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — human contributor process.
- **[README.md](README.md)** — public-facing install/usage.

When you make a meaningful structural decision, **add a section to DESIGN.md** so the next thread doesn't re-litigate it.
