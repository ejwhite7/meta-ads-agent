# CLAUDE.md

Comprehensive architectural reference for **meta-ads-agent** — an open-source, full-lifecycle autonomous agent for Meta advertising. This document is the canonical guide for every contributor (human or AI) working on the codebase.

---

## Project Overview

**meta-ads-agent** is an autonomous advertising agent that manages the complete lifecycle of Meta (Facebook/Instagram) ad campaigns: creation, optimization, budget allocation, creative rotation, audience management, and performance reporting. It operates on a configurable schedule, pulling live performance data, analyzing trends against goals, and taking action — all without human intervention for routine operations.

**Who it's for:**

- Performance marketers who want hands-off campaign optimization
- Agencies managing multiple client ad accounts at scale
- Developers building custom advertising automation on top of Meta's platform

**Current stage:** Alpha (v0.2.x), end-to-end functional. Smoke-tested against real Meta accounts; not yet load-tested at hundreds-of-campaigns scale. The dashboard's Campaigns page and a few legacy tool implementations have known rough edges tracked in GitHub issues.

**Key design principles** (rationale + rejected alternatives in [DESIGN.md](DESIGN.md)):

1. **Direct Marketing API integration** — All Meta operations go through `graph.facebook.com/v21.0` via axios. The earlier `meta-ads` Python CLI wrapper layer was retired because the published CLI's subcommand surface had drifted from our wrapper assumptions, breaking every CLI-backed tool at runtime. One auth flow, one rate limiter, one error model, no Python runtime dependency.
2. **Per-campaign goals.** Optimization targets (ROAS / CPA / CPL / CPC / CPM / cost-per-thruplay / etc.) are configured per individual campaign, not per account or per Meta objective. The agent **refuses to act on a campaign without an active goal** in `campaign_goals` and surfaces it via `_pending_guidance` audit rows.
3. **Outcome backfill.** Each tick, before the OODA loop, the `BackfillEngine` fills in `actual_outcome` + `performance_delta` for previously-successful decisions whose grading window has passed. The agent's track record is queryable.
4. **Stateless core, stateful session.** `runAgentLoop()` is a pure function. All lifecycle state (counters, timers, persistence) lives in `AgentSession`.
5. **Multi-model LLM.** Pluggable provider pattern supporting Claude (Anthropic) and GPT-4o (OpenAI) with a clean adapter interface. Adding a new provider requires implementing two methods.
6. **Dual-mode persistence.** SQLite for local / single-user, PostgreSQL for cloud / team. Schema is auto-bootstrapped on every connection (the published CLI ships no `.sql` files).
7. **Single published artifact.** The CLI is the only npm package. `core` and `meta-client` are bundled into it via `tsup`; the React `dashboard` ships as static assets in the same tarball. There is no public API contract for the inner packages.

## Companion documents

- **[README.md](README.md)** — public-facing install + usage.
- **[DESIGN.md](DESIGN.md)** — *why* the codebase is shaped this way; rejected alternatives.
- **[AGENTS.md](AGENTS.md)** — fast orientation for AI tools landing in fresh threads.
- **[SKILL.md](SKILL.md)** — skill manifest for Claude Code's skill-loader.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — human contributor process.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Agent Core | TypeScript 5.6, TypeBox 0.33, EventStream (custom) |
| LLM Providers | Anthropic SDK (claude-opus-4-5), OpenAI SDK (gpt-4o) |
| Meta Interface | axios direct calls to Marketing API v21.0 (graph.facebook.com) |
| CLI | commander.js, inquirer, winston, chalk |
| Dashboard UI | React 18, Vite, Tailwind CSS, shadcn/ui, Recharts |
| Dashboard API | Hono, Node.js HTTP server |
| Database (local) | SQLite via better-sqlite3, Drizzle ORM |
| Database (cloud) | PostgreSQL via pg, Drizzle ORM |
| Build | Turborepo 2, pnpm 9 workspaces |
| Lint/Format | Biome 1.9 |
| Test | Vitest 2, msw (API mocking) |
| Type Check | tsc strict, NodeNext modules |
| CI | GitHub Actions |
| Deployment | Local (npx), Docker (cloud) |

---

## Directory Structure

```
meta-ads-agent/
├── CLAUDE.md                          # This file — architectural reference
├── DESIGN.md                          # *Why* the codebase is shaped this way
├── AGENTS.md                          # Quick orientation for AI tools
├── SKILL.md                           # Skill manifest for Claude Code
├── README.md                          # Public-facing install + usage
├── CONTRIBUTING.md                    # Human contributor guide
├── LICENSE                            # MIT
├── package.json                       # Root pnpm workspace config
├── pnpm-workspace.yaml                # Workspace package glob
├── turbo.json                         # Turborepo pipeline config
├── biome.json                         # Linter/formatter config
├── tsconfig.base.json                 # Shared TypeScript config
├── .env.example                       # Environment variable template
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml                     # GitHub Actions CI pipeline
├── docker/
│   ├── Dockerfile                     # Multi-stage production build
│   └── docker-compose.yml             # App + Postgres for cloud mode
├── packages/
│   ├── tsconfig/                      # Shared TS config (base.json)
│   │
│   ├── core/                          # Agent loop, tools, LLM, audit, goals,
│   │   │                              #   snapshots, backfill, DB schema.
│   │   │                              #   Bundled into the published CLI; not
│   │   │                              #   exposed as its own npm package.
│   │   └── src/
│   │       ├── index.ts               # Public API barrel export
│   │       ├── types.ts               # AgentGoal, CampaignMetrics, AgentAction
│   │       ├── agent/
│   │       │   ├── loop.ts            # Stateless OODA cycle (filterByGoals,
│   │       │   │                  #   prompt-with-per-campaign-goals, decision)
│   │       │   ├── session.ts         # Stateful AgentSession (lifecycle, retry,
│   │       │   │                  #   audit-failure halt, snapshot, backfill)
│   │       │   └── types.ts           # AgentLoopContext, AgentLoopResult,
│   │       │                      #   AgentSessionConfig, SessionStatus
│   │       ├── tools/
│   │       │   ├── registry.ts        # Map-based tool registry
│   │       │   ├── executor.ts        # Tool execution with retry + hooks
│   │       │   ├── hooks.ts           # Before/after tool call hooks
│   │       │   ├── types.ts           # Tool<TParams>, ToolContext, ToolResult
│   │       │   ├── campaign/          # campaign domain (list/pause/scale/create/...)
│   │       │   ├── budget/            # budget domain (factory pattern: see _client.ts)
│   │       │   ├── creative/          # creative generation + analysis
│   │       │   └── reporting/         # metrics, anomalies, Slack, exports
│   │       ├── llm/
│   │       │   ├── stream.ts          # EventStream<T,R> primitive (dual consumption)
│   │       │   ├── registry.ts        # Lazy provider loading
│   │       │   └── providers/{claude,openai}.ts
│   │       ├── decisions/
│   │       │   ├── engine.ts          # parseActions, applyGuardrails,
│   │       │   │                  #   proposeActionsFull, extractFirstJsonArray
│   │       │   ├── scoring.ts         # (impact * confidence) / (risk + 0.1)
│   │       │   └── types.ts           # ActionProposal, GuardrailConfig, DecisionResult
│   │       ├── db/
│   │       │   ├── index.ts           # Factory (createDatabase / createDatabaseAsync)
│   │       │   ├── schema.ts          # Drizzle: agent_sessions, agent_decisions,
│   │       │   │                  #   campaign_snapshots, agent_config, campaign_goals
│   │       │   ├── bootstrap.ts       # Inlined SQL: tables → ALTERs → indexes (3-phase)
│   │       │   └── migrations/        # 0000_initial.sql + 0001_campaign_goals.sql
│   │       ├── audit/
│   │       │   ├── logger.ts          # AuditLogger + onFailure / consecutive-failure
│   │       │   ├── drizzle-adapter.ts # DrizzleAuditDatabase (SQLite/PG portable)
│   │       │   ├── backfill.ts        # BackfillEngine (runs before OODA loop each tick)
│   │       │   └── types.ts           # AuditRecord, PendingBackfill, BackfillUpdate
│   │       ├── goals/                 # Per-campaign goal management
│   │       │   ├── types.ts           # CampaignGoal, PrimaryKpi, PendingGuidance
│   │       │   ├── repository.ts      # CampaignGoalRepository (soft-delete + history)
│   │       │   └── defaults.ts        # inferDefaultKpi(objective)
│   │       ├── snapshots/
│   │       │   └── writer.ts          # DrizzleSnapshotWriter (per-tick batched insert)
│   │       └── config/
│   │           ├── index.ts           # loadConfig (env + ~/.meta-ads-agent/config.json)
│   │           └── types.ts           # AgentConfigSchema (Zod)
│   │
│   ├── meta-client/                   # Direct Marketing API client (axios)
│   │   └── src/
│   │       ├── index.ts               # Public API
│   │       ├── client.ts              # MetaClient facade composing endpoints
│   │       ├── errors.ts              # MetaError, RateLimitError, AuthError, etc.
│   │       ├── types.ts               # Campaign, AdSet, Ad, AdCreative, Insights*
│   │       └── api/
│   │           ├── client.ts          # ApiClient (axios + retry + rate limit)
│   │           ├── rate-limiter.ts    # BUC header parsing + per-account budget
│   │           └── endpoints/         # campaigns, adsets, ads, creatives,
│   │                                  #   insights, audiences, batch,
│   │                                  #   split-tests, rules, previews
│   │
│   ├── cli/                           # The publishable `meta-ads-agent` binary
│   │   ├── package.json               # bin: meta-ads-agent, version 0.2.x
│   │   ├── tsup.config.ts             # Bundles core + meta-client (noExternal)
│   │   ├── scripts/copy-dashboard-static.mjs  # Copies dashboard build into bundle
│   │   ├── dashboard-static/          # GENERATED on `pnpm build` (gitignored)
│   │   └── src/
│   │       ├── index.ts               # commander.js entry (shebang via tsup banner)
│   │       ├── commands/              # init, run, run-once, status, decisions,
│   │       │                          #   guidance, dashboard, report, pause,
│   │       │                          #   resume, config
│   │       ├── daemon/                # ipc client/server, manager (lifecycle)
│   │       └── utils/                 # display, logger (winston + splat), errors
│   │
│   └── dashboard/                     # React SPA (Vite + Tailwind)
│       ├── vite.config.ts             # source maps gated on VITE_SOURCEMAP env
│       ├── server.ts                  # Standalone Hono server (dev only)
│       └── src/
│           ├── main.tsx               # React entry; imports index.css for Tailwind
│           ├── index.css              # @tailwind base/components/utilities
│           ├── App.tsx, components/, pages/, hooks/
│           ├── lib/date-range.tsx     # DateRangeProvider context + presets
│           ├── components/DateRangePicker.tsx  # header date range picker
│           └── api/client.ts          # AuditRecord matches core's schema exactly
│
└── ~/.meta-ads-agent/                 # PER-USER STATE (outside the repo)
    ├── config.json                    # 0o600 -- token, account ID, LLM keys
    ├── agent.db                       # SQLite (auto-bootstrapped on connect)
    ├── agent.sock                     # Unix socket for daemon IPC
    └── daemon.json                    # PID + sessionId for cross-process coord
```

---

## Common Commands

All commands are run from the monorepo root.

```bash
# Install dependencies
pnpm install

# Build all packages (respects dependency order via Turborepo)
pnpm build

# Development mode (watch + rebuild)
pnpm dev

# Run all tests
pnpm test

# Lint and format check
pnpm lint

# Auto-fix lint and formatting
pnpm format

# TypeScript type checking (no emit)
pnpm typecheck

# Clean all build artifacts
pnpm clean

# Run the agent locally
pnpm --filter meta-ads-agent start

# Run the dashboard dev server
pnpm --filter @meta-ads-agent/dashboard dev

# Add a dependency to a specific package
pnpm --filter @meta-ads-agent/core add <package>

# Run tests for a specific package
pnpm --filter @meta-ads-agent/core test

# Generate a database migration
pnpm --filter @meta-ads-agent/core drizzle:generate

# Apply database migrations
pnpm --filter @meta-ads-agent/core drizzle:migrate
```

---

## 1. Agent Loop Architecture

The agent operates on an **OODA (Observe-Orient-Decide-Act)** cycle, adapted for advertising optimization:

### OODA Cycle

1. **Observe** — Pull live performance metrics from Meta via the Insights API. Collect spend, impressions, clicks, conversions, ROAS, CPA, and CPM for all active campaigns, ad sets, and ads. Data is fetched for the current day and a configurable lookback window (default: 7 days).

2. **Orient** — Feed the metrics to the LLM along with the user's goal configuration (target ROAS, CPA cap, budget limits). The LLM analyzes trends, identifies underperformers, spots scaling opportunities, and flags anomalies (e.g., sudden CPM spikes, creative fatigue, audience saturation).

3. **Decide** — The decision engine ranks proposed actions by `(expected_impact * confidence) / risk`. Each proposal includes: the tool to invoke, parameters, expected outcome, and risk assessment. Guardrails filter out proposals that violate constraints (budget floors, max scale factors, prohibited actions).

4. **Act** — Execute the top-ranked action(s) via the tool system. Each tool invocation is logged to the audit table with full context: input metrics, LLM reasoning, parameters, and expected outcome. If a tool fails, retry with exponential backoff (up to 3 attempts).

### Architecture Layers

```
┌─────────────────────────────────────┐
│          AgentSession               │  Stateful: manages lifecycle, retry,
│  - start() / stop() / pause()      │  session persistence, tick scheduling
│  - handles retry on failure         │
├─────────────────────────────────────┤
│          Agent                      │  Stateful: holds config, state ref,
│  - tick() runs one OODA cycle       │  tool registry, LLM provider ref
│  - manages iteration count          │
├─────────────────────────────────────┤
│          agentLoop()                │  STATELESS: pure function
│  - (state, tools, llm) => actions   │  No side effects, fully testable
│  - single OODA iteration           │
└─────────────────────────────────────┘
```

The **stateless core loop** (`agentLoop()`) is a pure function: given the current state, available tools, and an LLM provider, it returns a list of actions to take. It has no side effects, no I/O, and no persistence — making it trivially testable and deterministic with mocked inputs.

The **Agent** class wraps the loop with state management: it holds the tool registry, LLM provider reference, and current agent configuration. Its `tick()` method runs one OODA cycle.

The **AgentSession** adds lifecycle management: scheduled ticks on a configurable interval (default: 1 hour), max iterations per run (default: 24), automatic retry on transient failures, and session persistence to the database.

### Configuration

```typescript
interface AgentConfig {
  tickIntervalMs: number;        // Default: 3_600_000 (1 hour)
  maxIterationsPerRun: number;   // Default: 24
  maxRetries: number;            // Default: 3
  retryBackoffMs: number;        // Default: 5_000 (base for exponential)
  llmProvider: "claude" | "openai";
  llmModel: string;              // e.g., "claude-opus-4-5" or "gpt-4o"
  metaAdAccountId: string;
  lookbackDays: number;          // Default: 7
  dryRun: boolean;               // Default: false — log actions without executing
}
```

---

## 2. Tool System

Tools are the agent's interface to the outside world. Every action — creating a campaign, adjusting a budget, fetching insights — is a tool.

### Tool Definition (Factory Function Pattern)

Tools are **plain objects**, not classes. They follow the factory-function pattern from pi-mono:

```typescript
import { Type, type Static } from "@sinclair/typebox";

// 1. Define parameters with TypeBox (compile-time + runtime safety)
const UpdateBudgetParams = Type.Object({
  campaignId: Type.String({ description: "Meta campaign ID" }),
  dailyBudget: Type.Number({ minimum: 1, description: "New daily budget in account currency" }),
  reason: Type.String({ description: "Why the budget is being changed" }),
});

type UpdateBudgetParams = Static<typeof UpdateBudgetParams>;

// 2. Factory function returns a Tool object
export function createUpdateBudgetTool(metaClient: MetaClient) {
  return {
    name: "update_budget",
    description: "Update the daily budget for a campaign",
    parameters: UpdateBudgetParams,
    execute: async (params: UpdateBudgetParams): Promise<ToolResult> => {
      const result = await metaClient.campaigns.update(params.campaignId, {
        daily_budget: params.dailyBudget * 100, // Meta API uses cents
      });
      return { success: true, data: result };
    },
  };
}
```

### Tool Registry

The registry is a `Map<string, Tool>` keyed by tool name. Tools are registered at startup:

```typescript
const registry = new ToolRegistry();
registry.register(createUpdateBudgetTool(metaClient));
registry.register(createPauseCampaignTool(metaClient));
registry.register(createGetInsightsTool(metaClient));
// ... all tools
```

The registry validates that no duplicate names exist and that all TypeBox schemas compile correctly at registration time.

### Hooks

Before/after hooks enable cross-cutting concerns without touching tool implementations:

- **Before hooks**: Human approval flows (pause and wait for confirmation), parameter validation, rate limit checks, dry-run interception
- **After hooks**: Audit logging (write to `agent_decisions`), telemetry emission, result transformation

```typescript
registry.addBeforeHook("*", async (tool, params) => {
  if (rateLimiter.wouldExceedBudget(params)) {
    throw new RateLimitError("Action would exceed rate limit budget");
  }
});

registry.addAfterHook("*", async (tool, params, result) => {
  await auditLog.record(tool.name, params, result);
});
```

### Retry Strategy

Tool execution wraps each call in a retry handler with exponential backoff:

- **Attempts**: 3 (configurable)
- **Backoff**: `baseDelay * 2^attempt` (default base: 5 seconds)
- **Retryable errors**: Network timeouts, Meta API 429 (rate limit), Meta API 500+ (server errors)
- **Non-retryable errors**: 400 (bad request), 403 (permission denied), validation errors

---

## 3. LLM Adapter Layer

The LLM layer provides a unified interface across multiple model providers.

### LLMProvider Interface

```typescript
interface LLMProvider {
  readonly name: string;
  readonly model: string;

  /** Stream a multi-turn conversation with tool use */
  stream(messages: Message[], tools: ToolDefinition[]): EventStream<StreamEvent, LLMResponse>;

  /** Stream a simple text-in/text-out completion (no tools) */
  streamSimple(prompt: string, systemPrompt?: string): EventStream<StreamEvent, string>;
}
```

### EventStream<T, R>

The `EventStream` is the core streaming primitive, adapted from pi-mono. It supports **dual consumption**: async iteration for real-time event processing AND promise-based result extraction for simple "give me the final answer" usage.

```typescript
class EventStream<T, R> {
  // Async iteration — process events as they arrive
  async *[Symbol.asyncIterator](): AsyncIterator<T> { ... }

  // Promise extraction — await the final result
  get result(): Promise<R> { ... }

  // Abort the stream
  abort(): void { ... }
}
```

**Usage patterns:**

```typescript
// Pattern 1: Stream events in real-time (for UI, logging)
const stream = llm.stream(messages, tools);
for await (const event of stream) {
  if (event.type === "text") console.log(event.text);
  if (event.type === "tool_call") console.log(event.name, event.args);
}
const response = await stream.result;

// Pattern 2: Just get the final result
const response = await llm.stream(messages, tools).result;
```

### Provider Implementations

**ClaudeProvider** — Wraps `@anthropic-ai/sdk`. Maps Meta tool schemas to Anthropic's tool format. Handles streaming via `client.messages.stream()`. Supports extended thinking for complex optimization decisions.

**OpenAIProvider** — Wraps `openai` SDK. Maps tool schemas to OpenAI's function calling format. Handles streaming via `client.chat.completions.create({ stream: true })`.

### Registry Pattern (Lazy Loading)

Providers are registered by name and instantiated lazily (only when first requested). This avoids importing unused SDKs:

```typescript
const llmRegistry = new LLMRegistry();
llmRegistry.register("claude", () => new ClaudeProvider(config));
llmRegistry.register("openai", () => new OpenAIProvider(config));

// Later — provider is instantiated on first call
const provider = llmRegistry.get(process.env.LLM_PROVIDER ?? "claude");
```

### Adding a New Provider

1. Create `packages/core/src/llm/<name>.ts`
2. Implement `LLMProvider` interface (two methods: `stream`, `streamSimple`)
3. Register in `packages/core/src/llm/registry.ts`
4. Add SDK dependency to `packages/core/package.json`
5. Add configuration to `.env.example`
6. Write tests with mocked SDK responses

---

## 4. Meta Integration Layer

All Meta operations route through the **Marketing API at `graph.facebook.com/v21.0`** via axios. The agent has no Python or CLI runtime dependency.

> **History**: A `meta-ads` Python CLI wrapper layer existed previously and routed standard CRUD through subprocess spawns. That layer was retired because the published CLI's subcommand surface had drifted from our wrapper assumptions (singular vs plural nouns, no `auth` subcommand, different env var names) and was breaking every CLI-backed tool at runtime. Direct API calls are simpler, faster (no subprocess on every read), and don't depend on which CLI version the user has installed.

### Direct API Client

The `MetaClient` class is a façade composing per-resource endpoint classes, each backed by `ApiClient` (axios with auth, rate limiting, retry):

```typescript
class MetaClient {
  // Resource CRUD
  campaigns: CampaignEndpoints;   // GET/POST /act_<id>/campaigns, /<id>
  adSets:    AdSetEndpoints;
  ads:       AdEndpoints;
  creatives: CreativeEndpoints;
  insights:  InsightsEndpoints;   // GET /act_<id>/insights

  // Specialized capabilities
  audiences:  AudienceEndpoints;  // custom + lookalike
  batch:      BatchEndpoints;     // bulk ops, up to 50 per request
  splitTests: SplitTestEndpoints;
  rules:      RulesEndpoints;     // automated ad rules
  previews:   PreviewEndpoints;

  // Auth
  auth:       AuthClient;         // .whoami() probes /me
}
```

### Auth Validation

A token is considered valid iff `GET /me?fields=id,name` returns a 2xx with at least one identity field populated. The Graph API surfaces structured errors (`OAuthException (#190): Invalid OAuth access token`, `(#200): Requires extended permission: ads_management`, etc.) that the agent surfaces verbatim to the operator.

### Error Mapping

| HTTP status | Mapped error class | Agent response |
|-------------|--------------------|----------------|
| 400         | `ValidationError`  | Log error, do not retry (programming bug) |
| 401, 403    | `AuthError`        | Halt session, notify user |
| 404         | `NotFoundError`    | Log warning, skip action |
| 429         | `RateLimitError`   | Honour `Retry-After`, exponential backoff |
| 5xx         | `MetaError`        | Retry with backoff |

### Rate Limit Budget Tracker

Meta's Marketing API uses a Business Use Case (BUC) rate-limiting system with per-account token budgets. The `RateLimiter`:

1. Reads rate-limit headers from every API response (`x-business-use-case-usage`, `x-app-usage`).
2. Maintains a per-account budget (percentage of allocation consumed).
3. Blocks requests when budget exceeds 75% (configurable threshold).
4. Honours `estimated_time_to_regain_access` from BUC headers when present.

### Token Storage

- **Local mode**: Stored in `~/.meta-ads-agent/config.json` with `0o600` file permissions. Contains `metaAccessToken`, `metaAdAccountId`, `anthropicApiKey` or `openaiApiKey`, plus goal/guardrail config.
- **Cloud mode**: Read from environment variables (`META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, etc.). Never written to disk.

---

## 5. Decision Engine

The decision engine translates performance data + per-campaign goals into ranked action proposals. Goals are **per-campaign**, not per-account or per-objective — see [DESIGN.md §2](DESIGN.md).

### Goal Configuration

Two layers:

**Account-wide goal** (legacy `AgentGoal` type, kept for backwards compat):

```typescript
interface AgentGoal {
  roasTarget: number;        // legacy; not authoritative for new tools
  cpaCap: number;            // legacy
  dailyBudgetLimit: number;  // account-wide spend cap (still authoritative)
  riskLevel: "conservative" | "moderate" | "aggressive";
}
```

**Per-campaign goal** (`campaign_goals` table, the source of truth for per-tool decisions):

```typescript
interface CampaignGoal {
  adAccountId: string;
  campaignId: string;
  primaryKpi: "roas" | "cpa" | "cpl" | "cpc" | "ctr" | "cpm" | "cpi"
            | "cost_per_thruplay" | "thruplay_rate" | "frequency" | "reach";
  primaryKpiTarget: number;
  primaryKpiDirection: "maximize" | "minimize";
  secondaryKpis: SecondaryKpi[];                  // observational only
  minDailyBudget: number | null;                  // override of account-wide guardrail
  maxBudgetScaleFactor: number | null;            // override
  requireApprovalAbove: number | null;            // override
  lastSeenObjective: string;                      // for drift detection
  configuredAt: string;
  configuredBy: "init-wizard" | "guidance-cmd" | "dashboard" | "api";
  notes: string | null;
  deletedAt: string | null;                       // soft-delete tombstone
}
```

**Critical semantics:**

- **No goal → no action.** A campaign without an active goal in `campaign_goals` is recorded as `_pending_guidance` in the audit log and *no decision is made on it*. The agent loop's `filterByGoals` partitions campaigns into `actionable` and `pendingGuidance` buckets; only the actionable subset enters the LLM prompt.
- **Objective drift triggers re-prompt.** If a campaign's live `objective` differs from the goal's `lastSeenObjective`, the goal is soft-deleted in place and the campaign re-routes to pending guidance. The audit log captures the reason.
- **Soft-delete + history-by-insert.** Every reconfigure or reset inserts a new row. Active goal = most-recent row regardless of `deletedAt`, with a code-side check on that row's `deletedAt`. The naive `WHERE deletedAt IS NULL ORDER BY ... LIMIT 1` returns the wrong row when a tombstone exists — see [DESIGN.md §3](DESIGN.md) for the full rationale.
- **Default KPI inference (`inferDefaultKpi`)** suggests sensible per-objective defaults in the wizard (`OUTCOME_SALES → roas/3.0/maximize`, `OUTCOME_LEADS → cpl/$25/minimize`, etc.). Defaults are **never applied automatically** — always shown to the operator for confirmation.

### Action Proposal Ranking

Each proposed action is scored:

```
score = (expected_impact * confidence) / risk
```

Where:
- **expected_impact**: Estimated delta in the primary KPI (ROAS improvement, CPA reduction)
- **confidence**: 0-1 score from the LLM based on data quality, sample size, and historical accuracy
- **risk**: Downside magnitude if the action fails (budget wasted, performance regression)

Proposals are sorted by score descending. The top N actions are executed (N depends on risk level: conservative=1, moderate=3, aggressive=5).

### Guardrails

Hard constraints that override the decision engine. Each guardrail can be **overridden per campaign** via the corresponding `campaign_goals` column (NULL = inherit account-wide default):

- **Minimum budget floor**: No campaign budget can be set below `min_daily_budget` (account default $5).
- **Max scale factor**: Budget cannot increase more than `max_budget_scale_factor` per cycle (account default 2.0x).
- **Approval threshold**: Budget changes above `require_approval_above` (account default $1000) become `_pending_human_approval` audit rows instead of executing.
- **Prohibited actions**: Cannot delete campaigns, cannot change campaign objectives, cannot modify payment settings.
- **Spend velocity**: If daily spend exceeds 120% of `dailyBudgetLimit`, pause all scaling actions.
- **Cool-down period**: After a major change (budget > 50% increase), wait 2 ticks before modifying the same entity.

> Note: per-campaign override **enforcement** is wired through the schema and read paths but the executor still uses account-wide defaults. Wiring the overrides into `applyGuardrails` is queued (see [DESIGN.md "Decisions still pending"](DESIGN.md)).

### Decision Output Format

```typescript
interface DecisionResult {
  proposals: ActionProposal[];       // All proposals (ranked)
  selected: ActionProposal[];        // Proposals that passed guardrails
  rejected: ActionProposal[];        // Proposals blocked by guardrails
  reasoning: string;                 // LLM's explanation of the analysis
  metrics_snapshot: MetricsSnapshot; // Input data for audit trail
}
```

---

## 6. Audit & Decision Log

Every tool invocation is recorded in the `agent_decisions` table. This log is **append-only** — records are never updated or deleted, only INSERTed and (for backfill) UPDATEd in-place to fill `actual_outcome` and `performance_delta` columns.

### Table Schema (as it exists in code)

Field names match the Drizzle schema's TypeScript field names exactly. **The dashboard frontend reads these verbatim**; do not rename without coordinating across `core/audit/types.ts`, `core/db/schema.ts`, and `dashboard/src/api/client.ts:AuditRecord`.

```sql
CREATE TABLE agent_decisions (
  id                TEXT PRIMARY KEY,        -- UUID v4
  session_id        TEXT NOT NULL,           -- AgentSession that produced this decision
  ad_account_id     TEXT NOT NULL,           -- act_XXXXXXXXX
  tool_name         TEXT NOT NULL,           -- registered tool name OR synthetic _pending_*
  params            TEXT NOT NULL,           -- JSON: parameters passed to the tool
  reasoning         TEXT NOT NULL,           -- LLM's explanation
  expected_outcome  TEXT NOT NULL,           -- LLM's prediction OR PENDING_GUIDANCE / PENDING_HUMAN_APPROVAL
  score             REAL NOT NULL,           -- (impact * confidence) / (risk + 0.1)
  risk_level        TEXT NOT NULL,           -- 'low' | 'medium' | 'high'
  success           INTEGER NOT NULL,        -- 0/1; pending-* rows have success=0
  result_data       TEXT,                    -- JSON: tool's structured result
  error_message     TEXT,                    -- non-null when success=0
  -- Backfilled by BackfillEngine on a subsequent tick (see §6.5):
  actual_outcome    TEXT,                    -- JSON: actual metrics one tick later
  performance_delta TEXT,                    -- JSON: per-field diff vs the pre-decision baseline
  timestamp         TEXT NOT NULL            -- ISO 8601
);
```

Indexes (created by `bootstrap.ts`):

- `idx_decisions_session_id`, `idx_decisions_ad_account`, `idx_decisions_timestamp`, `idx_decisions_tool_name` — hot read paths.
- `idx_agent_decisions_pending_backfill (ad_account_id, success, actual_outcome)` — keeps the per-tick backfill scan O(pending), not O(all decisions ever).

### Synthetic tool names (don't filter these out without reason)

Not every audit row represents an executed tool. Three synthetic toolNames carry distinct semantics:

| `tool_name` | `expected_outcome` | Meaning |
|---|---|---|
| Real tool name (`set_budget`, `pause_campaign`, etc.) | LLM's prediction | A real action was attempted; `success` says whether it worked. |
| `_pending_human_approval` | `PENDING_HUMAN_APPROVAL` | Proposal exceeded the approval threshold; recorded but never executed. |
| `_pending_guidance` | `PENDING_GUIDANCE` | Campaign has no goal in `campaign_goals`, or its objective drifted, or its goal was reset. The agent refuses to act on it. |

When building tools or queries that count "actions taken," filter `tool_name NOT LIKE '\_%'` (and remember to escape the underscore in your dialect).

### Write Pattern

```typescript
/* On tool invocation */
await auditLogger.logDecision({
  sessionId, adAccountId, toolName: "set_budget",
  params: { campaignId: "123", dailyBudget: 50 },
  reasoning: "Campaign 123 has ROAS 5.2 above target 3.0 with stable CPA...",
  expectedOutcome: "Higher delivery, ROAS may dip 0.2-0.4",
  score: 0.84, riskLevel: "low", success: true,
  resultData: { newBudget: 50 }, errorMessage: null,
});

/* On a subsequent tick, BackfillEngine grades the prior decision: */
await auditLogger.backfillOutcomes([{
  decisionId: "...",
  actualOutcome: { roas: 4.9, spend: 49.83, impressions: 12000, ... },
  performanceDelta: { roas_delta: -0.3, spend_delta: 9.83, baselineRecordedAt: "..." },
}]);
```

### Halt-on-failure

The AuditLogger exposes `onFailure(listener)` and `getConsecutiveFailures()`. The session registers a listener that **halts the agent after 3 consecutive audit-log persistence failures** — the audit trail is the system of record; we don't run blind. See `agent/session.ts`.

### Outcome backfill (sub-section 6.5)

`BackfillEngine.run(currentMetrics, adAccountId)` runs **before** the OODA loop on every tick:

1. Lists successful prior-tick decisions for this account where `actual_outcome IS NULL` (oldest first — an outage backlog drains chronologically).
2. For each: extracts `campaignId` from `params` (canonical `campaignId`, fallback `campaign_id`).
3. Looks up the latest pre-decision snapshot in `campaign_snapshots` via the `(campaign_id, recorded_at)` index — this is the metrics the agent saw when it decided.
4. `actualOutcome` = current campaign metric snapshot.
5. `performanceDelta` = current minus baseline, per numeric field, plus `baselineRecordedAt` for traceability.
6. Persists via `auditLogger.backfillOutcomes()`.

Failure isolation is **per-row**: a corrupt decision doesn't poison the rest of the batch. Backfill failures are logged with `console.warn` and swallowed — backfill problems must never abort an OODA tick. Returns a `BackfillRunResult` with per-row counts (`pendingCount`, `backfilledCount`, `skippedNoCurrentMetrics`, `skippedNoCampaignId`, `errored`).

Edge cases handled (each has a comment + test in `audit/backfill.test.ts`):

| Case | Behavior |
|---|---|
| No pre-decision snapshot (decision predates the snapshot writer) | `actualOutcome` set, `performanceDelta` null |
| Account-wide tools (params has no `campaignId`) | Row stays pending forever (correct) |
| Campaign paused/deleted between decision and backfill | Stays pending, retries next tick |
| Failed decisions (`success=false`) | Never picked up; grading meaningless |
| Multi-tenant | All queries scoped by `adAccountId` |
| Idempotent | Once `actualOutcome` is non-null, never re-enters pending set |

**Important**: Never delete audit records. They form the ground truth for measuring agent effectiveness and debugging regressions.

---

## 7. Database

### ORM and bootstrap

- **Drizzle ORM** for type-safe schema definitions and queries.
- Schema lives in `packages/core/src/db/schema.ts`.
- **Schema is auto-bootstrapped on every connection.** The published CLI is a single bundled JS file with no `.sql` sidecars to ship, so we inline the schema as string constants and apply them on every `createDatabase()` call. All statements are `IF NOT EXISTS` / idempotent.
- Hand-written migration files live in `packages/core/src/db/migrations/` for drizzle-kit users; they are kept in sync with `bootstrap.ts` by hand.

### Three-phase bootstrap (read this before changing the schema)

`bootstrapSqliteSchema()` runs three explicit phases. **Order matters — see [DESIGN.md §8](DESIGN.md):**

1. **`SQLITE_BOOTSTRAP_TABLES_SQL`** — `CREATE TABLE IF NOT EXISTS` for every table.
2. **`SQLITE_BOOTSTRAP_ALTERS`** — idempotent `ALTER TABLE ... ADD COLUMN` statements; "duplicate column name" errors are swallowed. This handles the upgrade path for legacy DBs.
3. **`SQLITE_BOOTSTRAP_INDEXES_SQL`** — `CREATE INDEX IF NOT EXISTS`. Must run AFTER the ALTERs so any index that references a newly-added column (e.g. `idx_agent_decisions_pending_backfill` on `actual_outcome`) can resolve it.

When adding a new column to an existing table, you MUST add an entry to `SQLITE_BOOTSTRAP_ALTERS` so legacy DBs get it. Adding to the `CREATE TABLE` block alone only helps fresh DBs.

### Connection Factory

```typescript
import { createDatabase } from "@meta-ads-agent/core";

const conn = createDatabase({
  type: "sqlite",                                  // or "postgres"
  sqlitePath: "~/.meta-ads-agent/agent.db",        // default; override via SQLITE_PATH
  postgresUrl: process.env.DATABASE_URL,
});
const db = conn.db;                                // Drizzle handle
conn.close();
```

The default `sqlitePath` is `~/.meta-ads-agent/agent.db` (resolved at call time, not module load) so the daemon and any client tool converge on the same file regardless of cwd. Users who run an older relative-path config see a one-time migration warning with the exact `mv` command on first bootstrap. See [DESIGN.md §9](DESIGN.md).

### Tables

| Table | Purpose |
|---|---|
| `agent_sessions` | Active / completed agent run sessions; tracks state, iteration count, last error |
| `agent_decisions` | Append-only audit log (see §6) |
| `campaign_snapshots` | Per-tick performance snapshots; written by `DrizzleSnapshotWriter`, read by the dashboard's `/api/campaigns` and the `BackfillEngine` |
| `agent_config` | Stored goal configuration per ad account (legacy account-wide goals) |
| `campaign_goals` | Per-campaign goals (see §5); soft-delete + history-by-insert |

### Migration Commands

```bash
# Generate a Drizzle migration file after schema changes (does NOT replace bootstrap.ts):
pnpm --filter @meta-ads-agent/core drizzle:generate

# Apply pending Drizzle migrations against a Postgres URL (dev tooling):
pnpm --filter @meta-ads-agent/core drizzle:migrate
```

Production users do not run migrations — the auto-bootstrap path runs on every connection and converges to the right schema on both fresh and legacy DBs.

---

## 8. Dashboard

The dashboard ships **inside the published CLI tarball** as static React assets. Operators run `meta-ads-agent dashboard` and get a single Hono server serving both the SPA and the REST API on one port. See [DESIGN.md §6](DESIGN.md) for why we bundle rather than publish a separate package.

### Architecture

```
Vite build (packages/dashboard)
        ↓   (postbuild script: scripts/copy-dashboard-static.mjs)
packages/cli/dashboard-static/{index.html, assets/*}    ← ships in npm tarball
        ↓   (at runtime)
meta-ads-agent dashboard
        ↓
Hono server on one port (default :3001) serving:
  GET /                        → index.html with API key script-injected (§8.4)
  GET /assets/*                → static (JS bundle, CSS)
  GET /api/status              → latest session row OR live IPC daemon
  GET /api/decisions           → audit log (limit/offset/startDate/endDate)
  GET /api/campaigns           → campaign_snapshots
  POST /api/control/{pause,resume,run-once}
                               → IPC fan-out to running daemon + DB state update
```

### Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Agent state, session id, last/next tick |
| `GET` | `/api/decisions` | Paginated audit log; `limit`/`offset`/`startDate`/`endDate` query params |
| `GET` | `/api/campaigns` | Latest `campaign_snapshots` rows |
| `POST` | `/api/control/pause` | Pauses running daemon via IPC + updates DB state |
| `POST` | `/api/control/resume` | Resumes paused daemon |
| `POST` | `/api/control/run-once` | Triggers an immediate OODA tick |

### Authentication — fails closed

The server **refuses to start** unless one of:

- `DASHBOARD_API_KEY=<secret>` is set in env, OR
- `DASHBOARD_AUTH=none` is set explicitly (local dev only).

No silent permissive defaults. The API-key check uses `crypto.timingSafeEqual` for constant-time comparison.

```typescript
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
```

### API key auto-injection

The React frontend reads its API key from `localStorage["meta-ads-agent-api-key"]`. On a clean browser profile that storage is empty → every `/api/*` returns 401 → user is stuck with no recovery path. To avoid that, the server **injects a tiny bootstrap script into the served `index.html`** that primes `localStorage` from the server's process env on first load:

```html
<script>
(function(){try{
  var k = "<api-key>";  // JSON.stringify-escaped server-side
  var s = window.localStorage;
  if (s.getItem("meta-ads-agent-api-key") !== k)
    s.setItem("meta-ads-agent-api-key", k);
}catch(e){}})();
</script>
```

Three routes serve `index.html`: `/`, `/index.html`, and the SPA fallback `*`. Static assets bypass injection. See `cli/src/commands/dashboard.ts:serveIndex` and [DESIGN.md §7](DESIGN.md).

### CORS

Default: same-origin only (the bundled command serves SPA + API from the same port). Override with `DASHBOARD_CORS_ORIGIN=<url>`. In production (`NODE_ENV=production`), the server refuses to start without an explicit `DASHBOARD_CORS_ORIGIN`.

### Frontend conventions

- **`AuditRecord` field names match the backend schema exactly** (`reasoning`, `params`, `expectedOutcome`, `success`, `riskLevel`, etc.) — NOT the legacy aspirational shape (`llmReasoning`, `toolParams`, `status`). The dashboard server returns Drizzle rows verbatim. See `dashboard/src/api/client.ts`.
- **Status is derived, not stored.** `decisionStatus(d)` returns `pending | executed | failed`: pending iff `expectedOutcome === "PENDING_HUMAN_APPROVAL"` or `"PENDING_GUIDANCE"`, else `success ? executed : failed`.
- **Date range is global state.** `lib/date-range.tsx` provides a React context (`useDateRange()`) consumed by every page. Persisted to `localStorage`; preset-based ranges rehydrate against today's date.
- **Frontend filters apply client-side** for `status` and `search`; date range is sent server-side via `startDate`/`endDate` query params. Tool-name filtering server-side is queued.

---

## 9. Background Jobs

### Optimization Loop

The core optimization loop runs on a configurable cron schedule (default: every hour). Each tick:

1. Checks if the agent is in `running` state
2. Pulls fresh metrics from Meta
3. Runs one OODA cycle
4. Records decisions to the audit log
5. Schedules the next tick

### Report Generation Job

Runs daily (configurable). Generates a performance summary for the previous 24 hours:

- Total spend, impressions, clicks, conversions
- Per-campaign ROAS and CPA vs. targets
- Actions taken by the agent and their outcomes
- Anomalies detected
- Output: JSON stored in the database, optionally emitted as a webhook

### Creative Performance Analysis Job

Runs every 6 hours (configurable). Analyzes creative-level performance:

- Identifies creatives with declining CTR (creative fatigue)
- Flags top performers for scaling
- Suggests creative variations based on winning patterns
- Output: Recommendations fed into the next optimization tick

---

## 10. Security

### Secrets Management

- **All secrets are passed via environment variables** — never hardcoded, never in config files checked into source control
- `.env` files are gitignored
- `.env.example` documents every required variable with placeholder values

### Token Storage

- Local mode: `~/.meta-ads-agent/config.json` created with `0600` permissions (owner read/write only)
- Cloud mode: Tokens exist only in environment variables — nothing is written to disk

### API Key Authentication

- Dashboard API requires `X-API-Key` header on every request
- API key is compared in constant time to prevent timing attacks
- Failed auth attempts are logged with client IP

### Input Validation

- All CLI flags are validated against expected types and ranges before processing
- All API request bodies are validated against TypeBox schemas
- Meta API responses are validated before processing (defense against API changes)

### Principle of Least Privilege

- The Meta system user token should be scoped to only the required 7 permissions
- The agent never requests token scopes beyond what is needed
- Database credentials use limited-privilege roles (no DROP, no schema changes in production)

---

## 11. CI/CD

### GitHub Actions Pipeline

```yaml
# .github/workflows/ci.yml
# Triggers: push to main, pull requests

steps:
  1. Checkout code
  2. Setup Node.js 20
  3. Setup pnpm 9
  4. pnpm install --frozen-lockfile
  5. pnpm lint          # Biome check (formatting + lint rules)
  6. pnpm typecheck     # tsc --noEmit across all packages
  7. pnpm test          # Vitest across all packages
  8. pnpm build         # Turborepo build (dependency-ordered)
```

### Pipeline Rules

- All checks must pass before merging to `main`
- The pipeline uses `--frozen-lockfile` to ensure reproducible installs
- Build runs last because typecheck and test can catch issues faster
- Turborepo caches build outputs — repeat CI runs are significantly faster

---

## 12. Testing

### Unit Tests

Every tool and adapter has unit tests written with **Vitest**:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("createUpdateBudgetTool", () => {
  it("converts dollars to cents for Meta API", async () => {
    const mockClient = { campaigns: { update: vi.fn().mockResolvedValue({ success: true }) } };
    const tool = createUpdateBudgetTool(mockClient as any);
    await tool.execute({ campaignId: "123", dailyBudget: 50, reason: "scaling" });
    expect(mockClient.campaigns.update).toHaveBeenCalledWith("123", { daily_budget: 5000 });
  });
});
```

### Integration Tests

Integration tests use **msw** (Mock Service Worker) to intercept HTTP requests to the Meta API:

```typescript
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer(
  http.get("https://graph.facebook.com/v21.0/act_123/insights", () => {
    return HttpResponse.json({ data: [{ spend: "100.00", impressions: "5000" }] });
  }),
);
```

### E2E Agent Loop Test

A full end-to-end test that validates the agent loop can complete an OODA cycle:

1. Mock the LLM provider to return a predetermined analysis and action proposal
2. Mock the Meta API to return sample campaign data
3. Run one tick of the agent loop
4. Assert: correct tools were invoked, correct parameters were passed, audit log was written

```typescript
describe("Agent Loop E2E", () => {
  it("completes one OODA cycle with budget optimization", async () => {
    const mockLLM = createMockLLMProvider(/* predetermined responses */);
    const mockMeta = createMockMetaClient(/* sample campaign data */);
    const session = new AgentSession({ llm: mockLLM, meta: mockMeta, db: testDb });

    await session.tick();

    // Verify the action sequence
    expect(mockMeta.campaigns.update).toHaveBeenCalled();
    expect(testDb.query("SELECT * FROM agent_decisions")).toHaveLength(1);
  });
});
```

---

## 13. Known Agent Failure Patterns

Failure modes we've actually hit (not theoretical) during development. Every contributor should know these because they bite first-time users.

### Marketing API

1. **Marketing API surface drift.** Meta versions the API (`v21.0` today). When upgrading the version string in `meta-client/src/api/client.ts`, audit each endpoint module: field lists, enum values (objectives, optimization goals), and required-parameter sets all evolve between versions.

2. **Granular scope restrictions.** A token with `ads_management`/`ads_read` scopes still rejects `act_XXX` calls with `(#200) Ad account owner has NOT grant ads_management or ads_read permission` if the token's `granular_scopes.target_ids` doesn't include that account. Diagnose with `GET /debug_token`. Fix: regenerate the token with the account explicitly selected.

3. **App-level access tier.** Even with correct scopes + granular allowlist + system user assignment, the Meta App that issued the token must have at least Standard Access for `ads_management` / `ads_read` (or the system user must be a Developer/Admin of the app). Symptom is the same `(#200)` error.

4. **Rate limit budget tracking.** The Marketing API uses Business Use Case (BUC) rate limiting per ad account. The `RateLimiter` parses `x-business-use-case-usage` headers from every response and blocks new requests when usage exceeds the threshold (default 75%). Don't bypass it for "just one quick call" — the budget is shared and a 429 burns goodwill.

### Agent Loop

5. **Stateless loop state leakage.** `runAgentLoop` must not capture mutable closures or module-level state. All state flows through `AgentLoopContext`. Violations break testability and create race conditions if we ever run multiple agents in one process.

6. **LLM hallucinated tool calls.** The LLM may generate tool calls with invalid parameters (negative budgets, nonexistent campaign IDs). TypeBox schema validation in the executor catches type errors; business-logic validation (campaign existence, etc.) is the tool's responsibility.

7. **Brittle JSON extraction.** Early versions used `/\[[\s\S]*?\]/` regex to pull the actions array out of LLM output — broke on markdown code fences, inline arrays in prose, nested arrays in `params`, and brackets inside string literals. Use `extractFirstJsonArray` from `decisions/engine.ts` which prefers `<actions>...</actions>` blocks and uses balanced-bracket scanning with string-literal awareness.

8. **Decision feedback loop amplification.** Agent scales a well-performing campaign → performance dips slightly post-scale (common, due to learning re-entry) → agent overcorrects by pausing. The cool-down + max-scale-factor guardrails exist specifically to prevent this oscillation. Don't disable them for "experiments" without simulating the feedback dynamics.

9. **EventStream consumer abandonment.** If the async iterator of an EventStream is abandoned (caller breaks out of `for await`), the upstream HTTP connection may leak. Use `await stream.result()` for the simple case — don't iterate and await both, that's the redundant pattern fixed in PR #15.

10. **Provider SDK version drift.** Anthropic and OpenAI SDKs evolve rapidly. Pin exact versions in `package.json`. A new SDK version that changes streaming event shapes will silently break the provider implementation — our integration tests pin SDK behavior.

### Audit & Goals

11. **Audit-failure halt.** Three consecutive `auditLogger.logDecision` failures and the session halts itself (`state = "error"`, timer cancelled). The audit log is the system of record; we don't run blind. Don't increase the threshold without a serious reason.

12. **Soft-delete tombstone subtlety.** `CampaignGoalRepository.getActive` selects the most-recent row regardless of `deletedAt`, then returns `null` if that row is a tombstone. The naive `WHERE deletedAt IS NULL ORDER BY ... LIMIT 1` returns the *prior* live row when a tombstone exists — the opposite of intent. There's a regression test for this; if you bypass the repository, replicate the logic + test.

13. **Synthetic tool-name filtering.** Tools whose name starts with `_` (`_pending_human_approval`, `_pending_guidance`) are audit-log-only synthetics, not real tool invocations. Queries that count "actions taken" should filter `tool_name NOT LIKE '_%'` (escape underscore in your dialect).

### Database

14. **SQLite concurrent write contention.** SQLite in WAL mode handles concurrent reads but serializes writes. In local mode, only one daemon writes; the dashboard server (read-only) and CLI tools (mostly read) are fine alongside. There's a daemon PID file in `~/.meta-ads-agent/daemon.json` for cross-process coordination.

15. **Three-phase bootstrap ordering.** When adding a new column referenced by an index: column goes in `SQLITE_BOOTSTRAP_ALTERS`, index goes in `SQLITE_BOOTSTRAP_INDEXES_SQL`. **Do not** put the index in the TABLES block — legacy DBs will blow up with `no such column` because the ALTER hasn't run yet. PR #19 caught this; [DESIGN.md §8](DESIGN.md) has the full rationale.

16. **Postgres dialect parity.** Schema is currently SQLite-typed. Postgres works for inserts/selects but `mode: "boolean"` and `text enum` types don't fully translate. Don't use SQLite-specific features (`AUTOINCREMENT`, `PRIMARY KEY` without explicit type) in new tables — audit them against both backends.

### Dashboard

17. **Field-shape mismatch between frontend and backend.** The original dashboard scaffold used aspirational field names (`llmReasoning`, `toolParams`, `status`) that didn't match the actual `AuditRecord` shape (`reasoning`, `params`, `success`). The backend types are the source of truth; frontend types must mirror them exactly. Three different scaffold bugs (#18, #20, #21) traced back to this. **Always validate the type contract end-to-end** when touching either side.

18. **API key auto-injection.** The dashboard SPA reads its API key from `localStorage`. On a clean browser profile that's empty → 401 → user is stuck. The bundled `meta-ads-agent dashboard` server injects a `<script>` into `index.html` that primes `localStorage` from process env. Don't disable this without providing a UI alternative.

19. **Tailwind invisibility trap.** If no file imports a `.css` with `@tailwind` directives, Vite never invokes PostCSS, no stylesheet is emitted, and the entire UI renders as unstyled HTML — even though every component uses Tailwind classes and the config files exist. The fix is `import "./index.css"` in `main.tsx`. PR #20 caught this.

---

## Appendix: Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `META_ACCESS_TOKEN` | Yes | — | Meta system user access token |
| `META_AD_ACCOUNT_ID` | Yes | — | Meta ad account ID (format: `act_XXXXXXXXX`) |
| `META_APP_ID` | Yes | — | Meta app ID |
| `META_APP_SECRET` | Yes | — | Meta app secret |
| `ANTHROPIC_API_KEY` | If Claude | — | Anthropic API key |
| `OPENAI_API_KEY` | If GPT-4o | — | OpenAI API key |
| `LLM_PROVIDER` | No | `claude` | LLM provider (`claude` or `openai`) |
| `LLM_MODEL` | No | `claude-opus-4-5` | Model identifier |
| `DATABASE_MODE` | No | `sqlite` | Database backend (`sqlite` or `postgres`) |
| `DATABASE_URL` | If postgres | — | PostgreSQL connection string |
| `DASHBOARD_PORT` | No | `3000` | Dashboard API port |
| `DASHBOARD_API_KEY` | No | — | API key for dashboard authentication |
| `SENTRY_DSN` | No | — | Sentry error tracking DSN |

---

## Current Implementation Status

This section documents the current state of all packages, tool domains, and areas for future contribution.

### Packages

| Package | Published? | Description |
|---|---|---|
| `packages/core` | No (bundled) | Agent loop (stateless OODA), `AgentSession`, tool system with TypeBox schemas, LLM adapters (Claude + OpenAI), decision engine with scoring/guardrails/`extractFirstJsonArray`, Drizzle SQLite/Postgres schema with three-phase auto-bootstrap, `AuditLogger` + `BackfillEngine`, `CampaignGoalRepository`, `DrizzleSnapshotWriter`, config loader. |
| `packages/meta-client` | No (bundled) | Direct Marketing API client (axios to `graph.facebook.com/v21.0`). Per-resource endpoint classes: campaigns, ad sets, ads, creatives, insights, audiences, batch, split tests, rules, previews. Per-account rate limiter parsing BUC headers. Typed error hierarchy. |
| `packages/cli` | **Yes** (`meta-ads-agent`) | The published binary. Bundles `core` + `meta-client` via tsup; ships dashboard static assets in the same tarball. Commands: `init`, `run`, `run-once`, `status`, `decisions`, `guidance`, `dashboard`, `report`, `pause`, `resume`, `config`. Daemon manager, IPC client/server, Winston logger with splat formatting. |
| `packages/dashboard` | No (bundled) | React 18 + Vite + Tailwind. Pages: Overview, Decisions, Campaigns, Configuration, NotFound. Header date-range picker (`react-day-picker`). Build artifacts copied into `cli/dashboard-static/` on `pnpm build`. |

### Tool Domains

#### Campaign Management (`packages/core/src/tools/campaign/`)

| Tool Name | File | OODA Phase | Description |
|---|---|---|---|
| `list_campaigns` | `list-campaigns.ts` | Observe | List campaigns with status filter applied client-side |
| `pause_campaign` | `pause-campaign.ts` | Act | Pause a campaign; full audit row with `previousStatus`/`newStatus` |
| `scale_campaign` | `scale-campaign.ts` | Act | Scale daily budget by factor; guardrails: max-scale, min-budget, approval-threshold |
| `create_campaign` | `create-campaign.ts` | Act | Create a campaign with validated objective + budget |
| `duplicate_campaign` | `duplicate-campaign.ts` | Act | Copy a campaign (starts PAUSED for review) |
| `ab_test_campaign` | `ab-test-campaign.ts` | Act | Create A/B split test via direct API |
| `analyze_performance` | `analyze-performance.ts` | Orient | Per-campaign KPI gap analysis vs configured goal |

#### Budget Optimization (`packages/core/src/tools/budget/`)

Budget tools use a **factory pattern** -- they require a `MetaClient` instance at construction time. Use `createBudgetTools(client, goals, guardrails)` to instantiate all budget tools.

| Tool Name | File | Description |
|-----------|------|-------------|
| `get_budget_status` | `get-budget-status.ts` | Account-level spend pacing and burn rate analysis |
| `get_pacing_alerts` | `get-pacing-alerts.ts` | Campaign-level overpacing/underpacing detection |
| `set_budget` | `set-budget.ts` | Set absolute daily budget with guardrail enforcement |
| `reallocate_budget` | `reallocate-budget.ts` | Atomic budget transfer between campaigns |
| `optimize_bids` | `optimize-bids.ts` | Intelligent bid strategy adjustment (LOWEST_COST / COST_CAP / BID_CAP) |
| `project_spend` | `project-spend.ts` | End-of-period spend and performance projections |

#### Creative Generation (`packages/core/src/tools/creative/`)

| Tool Name | File | Description |
|-----------|------|-------------|
| `generate_ad_copy` | `generate-ad-copy.ts` | LLM-powered ad copy generation with Meta policy compliance |
| `create_ad_creative` | `create-ad-creative.ts` | Creates creatives in Meta via meta-client |
| `analyze_creative_performance` | `analyze-creative-performance.ts` | Winner/loser/fatigued classification |
| `rotate_creatives` | `rotate-creatives.ts` | Round-robin creative rotation for ad sets |
| `retire_creative` | `retire-creative.ts` | Retires poorly performing creatives with audit logging |
| `generate_image_prompts` | `generate-image-prompts.ts` | LLM-powered prompts for DALL-E / Midjourney / Ideogram |
| `clone_top_creative` | `clone-top-creative.ts` | Clones top performers with LLM-generated copy variations |

#### Reporting & Analytics (`packages/core/src/tools/reporting/`)

| Tool Name | File | Description |
|-----------|------|-------------|
| `get_campaign_metrics` | `get-campaign-metrics.ts` | Single campaign metrics retrieval |
| `generate_performance_report` | `generate-performance-report.ts` | Multi-format performance reports (JSON/Markdown/CSV) |
| `detect_anomalies` | `detect-anomalies.ts` | Anomaly detection vs. 7-day baseline (CPA spike, CTR drop, delivery issues) |
| `send_slack_webhook` | `send-slack-webhook.ts` | Slack Block Kit notifications for alerts and reports |
| `get_attribution_stats` | `get-attribution-stats.ts` | Attribution window analysis (1d/7d/28d click) |
| `export_report` | `export-report.ts` | File export for reports (JSON/Markdown/CSV) |

### Known TODOs (areas for future contribution)

Grouped by where they live in the architecture, with priority hints. Items already covered by an open issue should reference it.

#### Tier 1 (visible gaps, blocks meaningful use cases)

1. **Per-campaign guardrail enforcement.** `campaign_goals` schema columns `min_daily_budget`, `max_budget_scale_factor`, `require_approval_above` exist but `applyGuardrails` still uses account-wide defaults. Wire the per-campaign overrides in.
2. **Dashboard goal-edit form.** Operators currently configure goals via `meta-ads-agent guidance` (CLI). The dashboard has a banner placeholder but no edit form. Layer one in once the API contract is settled.
3. **Decisions-tab graded view.** Now that `actual_outcome` + `performance_delta` are populated, add a hit/miss filter and a per-tool accuracy chart.
4. **End-to-end MSW test.** Mock the Meta API + run a full OODA tick; assert the audit log and decision sequence. Specifically prevents the field-shape mismatch bugs we hit three times.

#### Tier 2 (architectural, not user-blocking)

5. **Postgres dialect parity.** Schema is SQLite-typed; some types don't translate cleanly. Either per-dialect schemas or a `commonTable` abstraction.
6. **Server-side filtering on `/api/decisions`.** Tool-name and search filters apply client-side today; the audit logger supports server-side filters and just needs them wired.
7. **Multi-account support.** All schemas are scoped by `adAccountId` already; the daemon assumes one. Lift the constraint when there's a real second-account need.

#### Tier 3 (nice-to-have / future)

8. **Webhook receiver.** An endpoint for Meta's real-time update webhooks (creative review, account status, etc.).
9. **Custom tool plugins.** Plugin directory for user-supplied tools.
10. **LLM cost tracking.** Track Claude/OpenAI token usage and dollar cost per OODA tick; surface on the dashboard.
11. **Rollback support.** When `performance_delta` shows a regression, allow the agent (with operator approval) to undo its last action.
12. **Docker / docker-compose.** Multi-stage Dockerfile + Postgres compose for cloud deployments. Skeletons exist; needs polish.

### How to Add a New Tool

Follow these steps to add a new tool to the agent:

**Step 1: Create the tool file**

Create a new file in the appropriate domain directory, e.g., `packages/core/src/tools/campaign/my-new-tool.ts`:

```typescript
import { Type, type Static } from '@sinclair/typebox';
import { createTool } from '../types.js';
import type { ToolContext, ToolResult } from '../types.js';

const MyNewToolParams = Type.Object({
  campaignId: Type.String({ description: 'Target campaign ID' }),
  // ... other parameters with TypeBox types
});

export const myNewTool = createTool({
  name: 'my_new_tool',
  description: 'Description of what this tool does',
  parameters: MyNewToolParams,
  async execute(params: Static<typeof MyNewToolParams>, context: ToolContext): Promise<ToolResult> {
    // Implementation here
    return {
      success: true,
      data: { /* result data */ },
      message: 'Tool executed successfully',
    };
  },
});
```

**Step 2: Export from the domain index**

Add the tool to the domain's `index.ts` (e.g., `packages/core/src/tools/campaign/index.ts`):

```typescript
import { myNewTool } from './my-new-tool.js';
export { myNewTool } from './my-new-tool.js';

// Add to the domain tools array
export const campaignTools = [
  // ... existing tools
  myNewTool,
];
```

**Step 3: Write tests**

Create `packages/core/src/__tests__/tools/campaign/my-new-tool.test.ts` using Vitest:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { myNewTool } from '../../../tools/campaign/my-new-tool.js';

describe('myNewTool', () => {
  it('should do the thing', async () => {
    const result = await myNewTool.execute(
      { campaignId: 'camp_123' },
      mockContext,
    );
    expect(result.success).toBe(true);
  });
});
```

**Step 4: Verify registration**

Run the integration tests to confirm your tool appears in `allTools`:

```bash
pnpm --filter @meta-ads-agent/core test -- tool-registry
```

**Step 5: Update CLAUDE.md**

Add your tool to the appropriate domain table in this section.
