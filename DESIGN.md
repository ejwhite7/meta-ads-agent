# Design rationale

This document explains *why* the meta-ads-agent codebase is shaped the way it is. **[CLAUDE.md](CLAUDE.md)** describes *what* exists; this document describes *why it isn't something else*. New contributors (human or agent) should read this when they're tempted to make a structural change — there's likely a previously-considered tradeoff captured here.

Each section is a decision with the alternatives we rejected and why. Sections are dated by approximate decision month so you can tell stale rationale from current.

---

## 1. Direct Marketing API, no Python CLI wrapper *(Apr 2026)*

**Decision:** All Meta operations go through `graph.facebook.com/v21.0` via `axios`. The earlier `meta-ads` Python CLI wrapper layer was retired.

**Rejected alternatives:**

- *Hybrid CLI + API* (the original CLAUDE.md design): Use the official Python CLI for standard CRUD, fall back to direct API for capabilities the CLI doesn't expose (audiences, batch, split tests, ad rules). **Why rejected**: the published Python CLI's subcommand surface had drifted from our wrapper assumptions in concrete ways — no `auth` subcommand at all, singular nouns (`campaign` not `campaigns`, `adset` not `ad-sets`), different env var names (`AD_ACCOUNT_ID` not `META_AD_ACCOUNT_ID`). Every CLI-backed tool was broken at runtime against the actual installed CLI.
- *Python-only via subprocess*: Lose all the CLI version-drift surface in exchange for taking a hard Python runtime dependency, plus subprocess-spawn cost on every read.

**Tradeoffs accepted:**

- We re-implement (and have to maintain) endpoint wrappers for every resource type. This is mostly mechanical and the surface is small.
- We're now coupled to Meta's API versioning policy. Bumping `v21.0` → `v22.0` is a deliberate cross-cutting change with a checklist (audit each endpoint module's field list, enums, required-parameter sets).

**Implementation pointers:**

- `packages/meta-client/src/api/client.ts` (axios + auth + rate limiting + retry).
- Endpoint modules under `packages/meta-client/src/api/endpoints/*`.
- `MetaClient` facade composes them.
- Token validation via `GET /me` (no `auth` CLI command exists).

---

## 2. Per-campaign goals, not per-account or per-objective *(May 2026)*

**Decision:** The agent's optimization target is configured **per individual campaign**, stored in a `campaign_goals` table. Without an active goal, the agent refuses to make decisions on the campaign.

**Rejected alternatives:**

- *Per-account targets* (the original `AgentGoal` model: `roasTarget`, `cpaCap`): One ROAS target for the whole account. **Why rejected**: it only works for accounts running pure-commerce campaigns. A lead-gen campaign reports `roas: 0` because there are no purchase conversions, and the agent's CPA-vs-cap delta becomes meaningless. Same problem for awareness, traffic, video, app campaigns.
- *Per-objective targets* (`byObjective: { OUTCOME_SALES: { roasTarget }, OUTCOME_LEADS: { costPerLeadCap }, ... }`): One target per Meta campaign objective. **Why rejected**: the same Meta objective covers wildly different intents. A high-margin product's sales campaign might target ROAS 5.0; a clearance push on the same account targets 1.5. Per-objective forces a one-size-fits-all rule that doesn't fit reality.

**Operator UX implication accepted:**

- Operator must touch every campaign at least once (CLI wizard or dashboard). Mitigated by sensible per-objective default *suggestions* in the wizard (`inferDefaultKpi`) so the typical case is one Enter-key per campaign.
- Agent re-prompts when a new campaign is detected, or when an existing campaign's `objective` field drifts from `lastSeenObjective`.

**Implementation pointers:**

- `packages/core/src/goals/types.ts` — `CampaignGoal`, `PrimaryKpi`, `PendingGuidance`.
- `packages/core/src/goals/repository.ts` — `CampaignGoalRepository`.
- `packages/core/src/agent/loop.ts:filterByGoals` — partitioning into actionable vs pending.
- `packages/cli/src/commands/guidance.ts` — operator UX.

---

## 3. Soft-delete + history-by-insert for goals *(May 2026)*

**Decision:** Every goal mutation is an `INSERT`. Reset = insert a tombstone row with `deletedAt` set. Reconfigure-after-delete = insert a fresh active row. The active goal is the **most-recent** row regardless of `deletedAt`, then we check that row's `deletedAt` in code.

**Rejected alternatives:**

- *Hard delete*: The original Q3 of the design discussion. **Why rejected**: The audit log already records every goal-set/goal-changed event, but having the goal table itself preserve history makes "what was the agent operating under at time T?" a single query against one table instead of joining the audit log. Cheap.
- *In-place UPDATE*: One row per `(account, campaign)`, mutated in place. **Why rejected**: Loses configuration history. If an operator says "the agent did something dumb yesterday," we can't tell whether the goal was different yesterday.

**The non-obvious part:** `getActive()` selects the most-recent row regardless of `deletedAt`, then returns null if that row is a tombstone. The naive `WHERE deletedAt IS NULL ORDER BY configuredAt DESC LIMIT 1` returns the *prior* live row when a tombstone exists after it — the opposite of what we want. There's a comment in `repository.ts` and a regression test for this.

**Implementation pointers:**

- `packages/core/src/goals/repository.ts:getActive` (and the comment block above it).
- `packages/core/src/__tests__/goals/repository.test.ts` — exercises the soft-delete + reconfigure path.

---

## 4. Snapshot writer is a separate concern from the audit log *(May 2026)*

**Decision:** Per-tick performance metrics live in `campaign_snapshots` (one row per campaign per tick). The audit log (`agent_decisions`) records *what the agent did*. Two separate tables, written by two separate components.

**Rejected alternatives:**

- *Roll snapshots into the audit log*: Add `metrics_snapshot` (JSON) to `agent_decisions`. **Why rejected**: The audit log is append-only and represents agent *actions*. Snapshots happen even on no-action ticks. Conflating them blows up the audit table size proportional to campaigns × ticks instead of decisions × ticks.
- *Skip snapshots entirely*: Read insights live from Meta whenever the dashboard needs them. **Why rejected**: The dashboard's `Campaigns` view and the backfill engine both need a *historical* time series. Re-fetching from Meta is rate-limited and lossy (Meta's API doesn't always return data for past windows reliably).

**Implementation pointers:**

- `packages/core/src/snapshots/writer.ts` — `DrizzleSnapshotWriter`.
- Wired into `AgentSession.executeTick` after `fetchMetrics`, before `runAgentLoop`.

---

## 5. Outcome backfill engine runs *before* the OODA loop, not after *(May 2026)*

**Decision:** Each tick, before the LLM call, we walk prior successful decisions whose `actual_outcome` is still NULL and fill them in using the current metrics. The agent then sees a partially-graded history when it reasons.

**Rejected alternatives:**

- *Backfill after the OODA loop*: Grade the previous tick's decisions using the metrics we just fetched. **Why rejected (subtle):** Doing it before means the LLM has the option to look at a recently-graded decision and reason about its performance ("we scaled c1 last tick targeting +20% spend, actual was +14% — closer to our model than expected"). Doing it after means the LLM never sees graded data.
- *Backfill in a separate cron / out-of-band job*: **Why rejected**: Operationally complex. The current approach is a few-millisecond DB scan per tick, with O(pending) rows (the composite index makes it cheap). Out-of-band would require a separate scheduler, separate process supervision, separate failure modes.

**Edge cases handled (each has a comment + test):**

- *No pre-decision snapshot* (decision predates the snapshot writer rollout): set `actualOutcome`, leave `performanceDelta` null.
- *Account-wide tools* (e.g. `generate_performance_report` whose params have no `campaignId`): row stays pending forever. Correct — there's nothing campaign-level to grade.
- *Campaign paused/deleted between decision and backfill*: row stays pending, retries automatically next tick when the campaign returns to metrics.
- *Failed decisions* (`success=false`): never picked up. Grading them is meaningless.
- *Idempotency*: once `actualOutcome` is non-NULL the row never re-enters the pending set.

**Implementation pointers:**

- `packages/core/src/audit/backfill.ts:BackfillEngine`.
- Composite index `idx_agent_decisions_pending_backfill` keeps the scan O(pending), not O(all).

---

## 6. Bundle the dashboard into the published CLI *(Apr 2026)*

**Decision:** The published `meta-ads-agent` npm package is a single bundle. The React dashboard is built by Vite and copied into `packages/cli/dashboard-static/`, which ships in the tarball. The `meta-ads-agent dashboard` command serves both the SPA and the API on one port via Hono.

**Rejected alternatives:**

- *Publish `@meta-ads-agent/core` and `@meta-ads-agent/meta-client` as separate packages, the CLI depends on them via npm*: **Why rejected**: it locks in API surfaces we don't actually want to maintain. Core and meta-client are implementation details. We'd have to do release coordination across three packages for every change. The npm `@meta-ads-agent` org would need to be claimed.
- *Ship the dashboard as a separate package (`@meta-ads-agent/dashboard`) and have users `npm i -g` both*: **Why rejected**: extra install step for users; same downsides as above.
- *Don't ship the dashboard at all; users clone the repo to use it*: **Why rejected**: meaningfully worse onboarding.

**Tradeoffs accepted:**

- Bundle size went from 200 KB compressed → 240 KB compressed (gzip-compressed JS+CSS). Worth it.
- Source maps removed from the published artifact (re-enabled locally with `TSUP_SOURCEMAP=true` / `VITE_SOURCEMAP=true`). Saved ~3 MB unpacked.

**Implementation pointers:**

- `packages/cli/tsup.config.ts` — bundles `noExternal: ["@meta-ads-agent/core", "@meta-ads-agent/meta-client"]`.
- `packages/cli/scripts/copy-dashboard-static.mjs` — copies the Vite build into `dashboard-static/` on every build.
- `packages/cli/src/commands/dashboard.ts` — Hono server.

---

## 7. Auto-inject API key into served HTML *(May 2026)*

**Decision:** When `meta-ads-agent dashboard` serves `index.html`, it injects a `<script>` that primes `localStorage["meta-ads-agent-api-key"]` from the server's process env. The frontend's existing `localStorage` read path is unchanged.

**Rejected alternatives:**

- *UI form to set the key*: **Why rejected for v0.2**: The first-load UX of an empty `localStorage` is "Connection Error / Unauthorized" with no recovery path. A form would work but feels heavyweight for a single-user local dashboard. The current approach reduces first-run friction to zero.
- *Skip auth entirely on localhost*: **Why rejected**: Sets a bad pattern. The same code path runs for users who reverse-proxy the dashboard; we want the API-key check to always be on.
- *Use a session cookie instead of localStorage*: **Why rejected (small)**: localStorage already worked, the SPA already read from there, and the threat model is the same (it's same-origin loopback).

**Threat model accepted:** The key is sent over loopback only. Anything that can read process env on the same machine already has the key. The injected value is `JSON.stringify`-escaped so a future caller passing a key with quotes/`</script>` can't break the page.

**Implementation pointer:** `packages/cli/src/commands/dashboard.ts:serveIndex`.

---

## 8. Three-phase schema bootstrap (tables → ALTER → indexes) *(May 2026)*

**Decision:** `bootstrapSqliteSchema` runs in three explicit phases. The `SQLITE_BOOTSTRAP_SQL` constant is now a concatenation kept for backwards compatibility, but the function uses three separate SQL blocks.

**Why three phases:** SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`. We use `ALTER` + swallow the "duplicate column name" error for idempotency. Indexes that reference newly-added columns (e.g. `idx_agent_decisions_pending_backfill` on `actual_outcome`) must run *after* the ALTER, otherwise legacy DBs blow up with `no such column: actual_outcome` before the ALTER ever runs.

**Rejected alternatives:**

- *Use a real migration runner (drizzle-kit migrate)*: **Why rejected**: The published CLI is a single bundled JS file. Migration runners read journal files from disk that we'd have to ship as additional files. Inlined SQL with idempotent semantics is simpler and works in the bundle.
- *Conditionally add the index based on a column-existence check*: **Why rejected**: SQLite's introspection is awkward at the SQL level; the conditional logic in Node is just `try/catch` around the ALTER, same complexity, less portable.

**Implementation pointer:** `packages/core/src/db/bootstrap.ts`.

---

## 9. SQLite default at `~/.meta-ads-agent/agent.db`, not `./data/agent.db` *(May 2026)*

**Decision:** Default `sqlitePath` resolves to `~/.meta-ads-agent/agent.db` at function-call time (not module load), co-located with `config.json`, `daemon.json`, and `agent.sock`. One canonical state directory.

**Rejected alternatives:**

- *Keep the relative `./data/agent.db` default*: **Why rejected**: meant the daemon, the dashboard, and any client tool needed to be run from the *exact same* working directory or they'd see different (empty) databases. Operators silently created scattered DBs; running `meta-ads-agent decisions` from anywhere other than the daemon's CWD blew up with cryptic SQLite errors.
- *Use XDG state dir on Linux*: **Why rejected for v0.2**: Cross-platform (`xdg-paths` library, varies by OS) is more complex than `homedir()`. Worth doing later if the project grows beyond developer machines.

**Migration story:** Users with a legacy `./data/agent.db` see a one-time warning on the next bootstrap with the exact `mv` command to preserve their history. We deliberately don't auto-migrate because moving an audit file is destructive.

**Implementation pointers:**

- `packages/core/src/config/types.ts:DEFAULT_SQLITE_PATH`.
- `packages/core/src/db/index.ts:createSqliteConnection` (the legacy-warning code path).

---

## 10. Decision filter applied client-side until the API supports it *(May 2026)*

**Decision:** The dashboard's Decisions tab fetches `limit=200` and applies `status` / search filters in the browser via `useMemo`. Date range and pagination ARE sent server-side; tool-name and free-text are not yet.

**Rejected alternatives:**

- *Block on full server-side filter support*: **Why rejected**: The frontend was completely broken (PR #21 — wrong field names) and needed a rewrite anyway. Client-side filtering on a 200-row page is fine; we'll move tool-name + search server-side when there's a real performance reason.

**Pointer:** `packages/dashboard/src/api/client.ts:getDecisions` and `packages/dashboard/src/pages/Decisions.tsx`.

---

## 11. Stateless OODA loop, stateful session *(Mar 2026, original design — still holds)*

**Decision:** `runAgentLoop()` is a pure function. All state (counters, timers, persistence) lives in `AgentSession`. This separation predates this thread and has held up well.

**Implication for new contributors:** When you're tempted to add `let lastFoo` inside the loop, you're probably writing it at the wrong layer. Pass it through the `AgentLoopContext` parameter or stash it in `AgentSession`.

---

## Decisions still pending

These are open design questions that haven't been forced by code yet:

- **Per-campaign budget guardrail enforcement.** The schema columns exist (`min_daily_budget`, `max_budget_scale_factor`, `require_approval_above` on `campaign_goals`) but the executor still uses account-wide defaults. Wiring per-campaign overrides into the guardrail engine is queued.
- **Postgres dialect parity.** Schema is currently SQLite-typed. The Postgres path opens a connection but uses the same Drizzle schema definitions; some types (`integer mode: "boolean"`, `text enum`) don't translate cleanly. Needs a per-dialect schema OR a `commonTable` abstraction.
- **Server-side filtering on the Decisions endpoint.** Tool-name and search would be cheap to add. Pagination cursors instead of offset would be cheap too.
- **End-to-end MSW integration test.** CLAUDE.md §13 #1 lists this as still-TODO. Worth doing once the per-campaign goal flow is stable.

When you pick one of these up, add a section here when you ship.
