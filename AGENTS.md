# AGENTS.md

Quick orientation for AI agents (Claude Code, Cursor, Aider, Codex, etc.) working on this codebase. Optimized for being read in a fresh thread when the agent has no prior context.

For depth, read in this order:

1. **This file** — fastest path to "where do I start, what's safe to change?"
2. **[CLAUDE.md](CLAUDE.md)** — comprehensive architectural reference, every package.
3. **[DESIGN.md](DESIGN.md)** — *why* the codebase is shaped this way; rejected alternatives.
4. **[CONTRIBUTING.md](CONTRIBUTING.md)** — human-contributor PR process.

---

## What this project is

`meta-ads-agent` is an autonomous agent that manages Meta (Facebook / Instagram) ad campaigns. It runs an OODA loop on a configurable interval (default 1h), pulls live performance data, asks an LLM what to do, applies guardrailed actions, and grades its own decisions on subsequent ticks via a backfill engine.

**Published as a single npm package** (`meta-ads-agent`, current alpha at `0.2.x`). Bundled as one ESM file via `tsup`; the React dashboard ships as static assets inside the same tarball.

---

## Project shape (memorize this)

```
meta-ads-agent/                 # pnpm + Turborepo monorepo
├── packages/
│   ├── core/                   # OODA loop, decision engine, audit logger,
│   │                           #   per-campaign goals, snapshot writer,
│   │                           #   backfill engine, Drizzle schema, LLM
│   │                           #   adapters. NOT published; bundled into CLI.
│   ├── meta-client/            # Direct Marketing API client (axios).
│   │                           #   NOT published; bundled into CLI.
│   ├── cli/                    # The published `meta-ads-agent` binary.
│   │                           #   `tsup` bundles core + meta-client into it.
│   │                           #   `dashboard-static/` is generated at build
│   │                           #   time from packages/dashboard/dist.
│   ├── dashboard/              # React SPA (Vite). Build output is copied
│   │                           #   into cli/dashboard-static/ on `pnpm build`.
│   └── tsconfig/               # Shared TS config.
├── CLAUDE.md, DESIGN.md, README.md, CONTRIBUTING.md, AGENTS.md (this file)
└── ~/.meta-ads-agent/          # Per-user state: config.json, agent.db,
                                #   agent.sock, daemon.json. Outside the repo.
```

The two key principles:

1. **`core` is the source of truth.** Most architectural decisions live there — schemas, types, agent loop, LLM contract, audit logging.
2. **`cli` is the only published artifact.** Anything in `core` or `meta-client` ships only because it's bundled into the CLI's JS. There's no public API contract for those packages.

---

## Common commands

```bash
pnpm install                # one-time setup
pnpm build                  # turbo run build (deps in order; auto-copies dashboard)
pnpm test                   # all packages
pnpm typecheck              # all packages
pnpm lint                   # biome check (NOT --write)
pnpm format                 # biome check --write (auto-fix)

# Per-package (faster iteration):
pnpm --filter @meta-ads-agent/core test
pnpm --filter @meta-ads-agent/core typecheck

# Run the CLI from source:
pnpm cli <command>          # auto-builds workspace deps first

# Open the bundled CLI without installing:
node packages/cli/dist/index.js <command>
```

**Full pipeline before pushing a PR**: `pnpm format && pnpm typecheck && pnpm test && pnpm lint && pnpm build`. Any one failing means CI fails.

---

## Required reading for the file you're about to touch

| Before you touch... | Read first |
|---|---|
| `packages/core/src/agent/*` | CLAUDE.md §1, §2; DESIGN.md §11 (stateless loop). |
| `packages/core/src/decisions/*` | CLAUDE.md §5; PR #15's JSON-extraction logic. |
| `packages/core/src/db/*` | CLAUDE.md §7; DESIGN.md §8, §9 (3-phase bootstrap, default path). |
| `packages/core/src/audit/*` | DESIGN.md §5 (backfill engine). |
| `packages/core/src/goals/*` | DESIGN.md §2, §3 (per-campaign goals, soft-delete). |
| `packages/core/src/snapshots/*` | DESIGN.md §4. |
| `packages/meta-client/*` | CLAUDE.md §4; DESIGN.md §1 (no Python CLI). |
| `packages/cli/src/commands/dashboard.ts` | DESIGN.md §6, §7 (bundling, key injection). |
| Anything in `packages/dashboard/src/api/client.ts` | CLAUDE.md "AuditRecord field names match the backend exactly" — common scaffold-bug area. |

---

## Code conventions specific to this repo

### Tools follow a factory + TypeBox pattern

```ts
// Tools are plain objects, not classes. Factory function + TypeBox schema.
const ParamsSchema = Type.Object({ campaignId: Type.String(), ... });

export function createSetBudgetTool(client: MetaClient | null = null) {
  return createTool({
    name: "set_budget",
    description: "...",
    parameters: ParamsSchema,
    async execute(params, context) {
      // resolve client from context if not pre-bound
      const c = client ?? (context.metaClient as MetaClient);
      // ...
    },
  });
}
```

The `client | null` pattern matters — it's how tools work both when bound to a specific MetaClient (e.g. tests, multi-account) and when registered statically against the agent's runtime client (`tools/budget/_client.ts:resolveMetaClient`).

### Audit log is append-only and is the system of record

- Every decision goes through `AuditLogger.logDecision`.
- Three consecutive failures and the agent halts itself. We don't run blind.
- Special tool names beginning with `_` (`_pending_human_approval`, `_pending_guidance`) are synthetic — they're records of *what the agent wanted to do but didn't*. Don't filter them out without reason.

### Goals are per-campaign, soft-deleted

- Read with `CampaignGoalRepository.getActive(adAccountId, campaignId)`.
- Returns `null` if no goal exists OR the most-recent row is a tombstone. **Do not** use `WHERE deletedAt IS NULL ORDER BY ... LIMIT 1` — that returns the prior live row when a tombstone exists after it. The repository handles this correctly; if you go around it, replicate the logic.
- Configure via `meta-ads-agent guidance` (CLI) or `init` wizard. Programmatic via `repo.upsert()`.

### Drizzle schema lives in `packages/core/src/db/schema.ts`

- Currently SQLite-typed. Postgres works for inserts/selects but `mode: "boolean"`/`enum` types don't fully translate. (Tracked: DESIGN.md "Decisions still pending".)
- Schema changes also require:
  1. Update `packages/core/src/db/bootstrap.ts` (the inlined SQL — published CLI has no `.sql` files).
  2. If new columns: add an idempotent ALTER to `SQLITE_BOOTSTRAP_ALTERS`.
  3. If new index references new columns: it goes in `SQLITE_BOOTSTRAP_INDEXES_SQL`, NOT in the `TABLES` block — see DESIGN.md §8.
  4. Add a `.sql` migration file under `packages/core/src/db/migrations/` for drizzle-kit users.

### LLM provider contract

- `LLMProvider.streamSimple(prompt, system)` returns an `EventStream<string, string>`.
- The agent uses `streamSimple` (not `stream` with tools) and parses an `<actions>` JSON array out of the response. The robust extractor lives in `packages/core/src/decisions/engine.ts:extractFirstJsonArray`.
- `await stream.result()` is sufficient; don't iterate AND await — see PR #15 for why.

### Bundling

- `tsup` bundles `core` and `meta-client` (`noExternal`).
- Native deps stay external (`better-sqlite3`, `pg`).
- Dynamic-require libs stay external (`winston`, `drizzle-orm`).
- Source maps OFF by default; opt in with `TSUP_SOURCEMAP=true` / `VITE_SOURCEMAP=true` for local debugging.

---

## PR conventions

- Branch from `main`. Name as `feat/...`, `fix/...`, `chore/...`, `refactor/...`, `docs/...`.
- Commit messages: imperative subject, body wraps at 72-ish, explains *why*. The big PRs in this repo have detailed bodies — match that level of detail when the change is non-trivial.
- Bump `packages/cli/package.json:version` when the change is user-visible (CLI command added/changed, behavior change, fix users will notice).
- The version sequence is the canonical one shipped to npm; don't reuse versions even if a prior PR claimed one and was later replaced.
- PR description should include: what broke (or what's new), why this approach, what was rejected, verification (typecheck / test / lint / build all pass), and a "for users mid-thread" if there's an upgrade path.

---

## Common gotchas

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cannot find module '.../core/dist/index.js'` | CLI run via `tsx` against an unbuilt workspace dep | `pnpm cli` (auto-builds) or `pnpm build` first |
| `no such table: agent_decisions` | Bootstrap didn't run (or your DB is at the wrong path) | Confirm `cfg.sqlitePath`; bootstrap is auto-applied on connection |
| `Cannot read properties of undefined (reading 'length')` in dashboard | Frontend type doesn't match backend response shape | Look at `packages/dashboard/src/api/client.ts:AuditRecord` vs the schema |
| `IPC server listening on %s` (literal `%s`) | winston `splat()` format not in chain | Already fixed in `utils/logger.ts`; don't regress |
| `(#200) Ad account owner has NOT grant ads_management` | Token doesn't have granular scope on this account | `curl /me/permissions`; regenerate token with the account selected |
| Dashboard Decisions tab crashes | `AuditRecord` field shape mismatch | See PR #21; backend ground truth is `core/audit/types.ts` |
| Tests fail with `no such column: actual_outcome` | Test bootstrapped its own SQL without the new column | Use `bootstrapSqliteSchema()` not inline `CREATE TABLE` |

---

## What NOT to change without good reason

- **The audit log schema** — append-only, one row per decision. Adding columns OK; renaming/removing breaks history.
- **`AuditRecord` field names** — they match Drizzle's auto-generated camelCase. The dashboard reads them verbatim.
- **`CampaignGoalRepository.getActive` logic** — the soft-delete tombstone behavior is subtle; see DESIGN.md §3.
- **Audit-log halt behavior** — 3 consecutive failures stops the session deliberately. We don't run blind.
- **Goal-required semantics** — agent refuses to act without explicit goals. This is the design (DESIGN.md §2), not a bug.

---

## What's safe to change

- Adding a new tool (campaign / budget / creative / reporting domain): follow the factory pattern, register in the appropriate domain `index.ts`.
- Adding a new CLI command: register in `packages/cli/src/index.ts:registerXCommand`.
- Adding a new dashboard page: standard React Router + `useDateRange()` for the global filter.
- Adding a new KPI: 4 places — `goals/types.ts:PrimaryKpi` union, `goals/defaults.ts` map, agent loop's prompt composition, `analyze_performance` analyzer.
- Adding a new endpoint to `meta-client`: new file under `api/endpoints/`, exported from `client.ts` facade and `index.ts` barrel.

---

## Security and safety

- **Never log access tokens or API keys.** No exceptions. The audit log records `params` JSON-stringified; if a tool ever stuffs a token in there it ends up in the audit table.
- **`writeFileSync` for any config containing secrets must use `mode: 0o600`** AND `unlink` first if the file exists (mode is ignored on existing files; see `init.ts`).
- **Constant-time compare for the API key**: `timingSafeEqual` (already wired in dashboard server). Don't replace with `!==`.
- **Dashboard fails closed**: server refuses to start without `DASHBOARD_API_KEY` unless `DASHBOARD_AUTH=none`. Don't add silent permissive defaults.

---

## When in doubt

- **Read DESIGN.md** first — it captures the rationale behind a decision you're about to second-guess.
- **Search the audit log** for `_pending_*` rows to understand what the agent has been refusing to do.
- **Check if there's a related PR.** This repo's PRs are detailed and document the decisions they ship. `gh pr list --state all --limit 30 --json number,title`.

If a change touches multiple architectural surfaces (schema + agent + CLI + dashboard), open a draft PR with just the type changes first, get them locked, then layer on the wiring. The dashboard scaffold has had three field-shape mismatch bugs (#18, #20, #21) — when in doubt, validate the type contract end-to-end.
