# CLAUDE.md

Comprehensive architectural reference for **meta-ads-agent** — an open-source, full-lifecycle autonomous agent for Meta advertising. This document is the canonical guide for every contributor (human or AI) working on the codebase.

---

## Project Overview

**meta-ads-agent** is an autonomous advertising agent that manages the complete lifecycle of Meta (Facebook/Instagram) ad campaigns: creation, optimization, budget allocation, creative rotation, audience management, and performance reporting. It operates on a configurable schedule, pulling live performance data, analyzing trends against goals, and taking action — all without human intervention for routine operations.

**Who it's for:**

- Performance marketers who want hands-off campaign optimization
- Agencies managing multiple client ad accounts at scale
- Developers building custom advertising automation on top of Meta's platform

**Current stage:** Greenfield — the monorepo scaffold, build pipeline, and architectural contracts are in place. Core implementation is underway.

**Key design principles:**

1. **Hybrid Meta integration** — Use Meta's official `meta-ads` Python CLI (47 commands) for standard CRUD operations, fall back to the Marketing API directly (via axios) for capabilities the CLI lacks (audiences, batch ops, A/B testing, ad rules).
2. **Stateless core, stateful wrapper** — Inspired by pi-mono's architecture. The agent loop itself is a pure function with no side effects. State management (sessions, persistence, retry) lives in wrapper layers.
3. **Multi-model LLM** — Pluggable provider pattern supporting Claude (Anthropic) and GPT-4o (OpenAI) with a clean adapter interface. Adding a new provider requires implementing two methods.
4. **Dual-mode persistence** — SQLite for local development and single-user deployment, PostgreSQL for cloud/team environments. Switchable via a single environment variable.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Agent Core | TypeScript 5.6, TypeBox 0.33, EventStream (custom) |
| LLM Providers | Anthropic SDK (claude-opus-4-5), OpenAI SDK (gpt-4o) |
| Meta Interface | meta-ads Python CLI (subprocess) + axios (Marketing API v21.0) |
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
├── CLAUDE.md                          # This file — architecture reference
├── README.md                          # Open-source README
├── CONTRIBUTING.md                    # Contributor guide
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
│   ├── tsconfig/                      # Shared tsconfig package
│   │   ├── package.json
│   │   └── base.json
│   ├── core/                          # Agent loop, tools, LLM adapters, DB
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # Public API barrel export
│   │       ├── agent/
│   │       │   ├── loop.ts            # Stateless core agent loop (OODA)
│   │       │   ├── session.ts         # Stateful AgentSession wrapper
│   │       │   └── types.ts           # AgentConfig, AgentState, Tick
│   │       ├── tools/
│   │       │   ├── registry.ts        # Map-based tool registry
│   │       │   ├── types.ts           # Tool<TParams> interface, TypeBox schemas
│   │       │   ├── hooks.ts           # Before/after tool call hooks
│   │       │   ├── meta/              # Meta-specific tools
│   │       │   │   ├── create-campaign.ts
│   │       │   │   ├── update-budget.ts
│   │       │   │   ├── pause-campaign.ts
│   │       │   │   ├── get-insights.ts
│   │       │   │   ├── create-audience.ts
│   │       │   │   └── ...
│   │       │   └── analysis/          # Analysis & decision tools
│   │       │       ├── analyze-performance.ts
│   │       │       ├── suggest-optimization.ts
│   │       │       └── ...
│   │       ├── llm/
│   │       │   ├── provider.ts        # LLMProvider interface
│   │       │   ├── registry.ts        # Provider registry (lazy loading)
│   │       │   ├── event-stream.ts    # EventStream<T,R> primitive
│   │       │   ├── claude.ts          # ClaudeProvider (Anthropic SDK)
│   │       │   └── openai.ts          # OpenAIProvider (OpenAI SDK)
│   │       ├── decision/
│   │       │   ├── engine.ts          # Decision engine (scoring, ranking)
│   │       │   ├── goals.ts           # Goal config schema
│   │       │   ├── guardrails.ts      # Safety constraints
│   │       │   └── types.ts           # ActionProposal, DecisionResult
│   │       ├── db/
│   │       │   ├── index.ts           # Connection factory (SQLite/Postgres)
│   │       │   ├── schema.ts          # Drizzle table definitions
│   │       │   ├── migrations/        # Drizzle migration files
│   │       │   └── audit.ts           # Audit log write helpers
│   │       └── api/
│   │           ├── server.ts          # Hono HTTP server
│   │           ├── routes/            # Route handlers
│   │           └── middleware.ts      # Auth, validation, error handling
│   ├── meta-client/                   # Meta API client (CLI + direct API)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # Public API
│   │       ├── cli/
│   │       │   ├── executor.ts        # Spawn `meta ads` subprocess
│   │       │   ├── parser.ts          # Parse JSON/plain output
│   │       │   └── commands.ts        # Typed wrappers for all 47 CLI commands
│   │       ├── api/
│   │       │   ├── client.ts          # axios-based Marketing API client
│   │       │   ├── audiences.ts       # Custom/Lookalike audience operations
│   │       │   ├── batch.ts           # Batch API operations
│   │       │   ├── ab-testing.ts      # A/B test creation and management
│   │       │   └── ad-rules.ts        # Automated ad rules engine
│   │       ├── rate-limit.ts          # Per-account token budget tracker
│   │       └── auth.ts               # Token storage and retrieval
│   ├── cli/                           # CLI application (publishable as npx)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # Entry point (#!/usr/bin/env node)
│   │       ├── commands/              # commander.js command definitions
│   │       └── ui/                    # inquirer prompts, chalk formatting
│   └── dashboard/                     # React web UI
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── main.tsx               # React entry point
│           ├── components/            # shadcn/ui components
│           ├── pages/                 # Dashboard pages
│           └── hooks/                 # React hooks for API calls
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

The Meta integration uses a **hybrid architecture**: the official CLI for standard operations and direct API calls for capabilities the CLI lacks.

### CLI Wrapper

The `meta-ads` Python CLI (v1.x, PyPI) provides 47 commands across 11 resource groups. The wrapper spawns it as a subprocess:

```typescript
class MetaCLIExecutor {
  async execute(command: string[]): Promise<CLIResult> {
    // Spawns: python3 -m meta_ads <command> --output json --no-input
    const proc = spawn("python3", ["-m", "meta_ads", ...command, "--output", "json", "--no-input"]);
    // Parse stdout as JSON, handle exit codes
  }
}
```

**Exit code handling:**

| Code | Meaning | Agent Response |
|------|---------|----------------|
| 0 | Success | Process result normally |
| 1 | General error | Retry with backoff |
| 2 | Usage error | Log error, do not retry (bug in our code) |
| 3 | Auth error | Halt session, notify user |
| 4 | API error | Parse error, retry if transient |
| 5 | Not found | Log warning, skip action |

**CLI resource groups (47 commands):**

- **Authentication** (2): `auth setup`, `auth status`
- **Ad Accounts** (2): `ad-accounts list`, `ad-accounts show`
- **Pages** (1): `pages list`
- **Campaigns** (5): `campaigns list/show/create/update/delete`
- **Ad Sets** (5): `ad-sets list/show/create/update/delete`
- **Ads** (5): `ads list/show/create/update/delete`
- **Creatives** (5): `creatives list/show/create/update/delete`
- **Datasets/Pixels** (6): `datasets list/show/create/update/delete/upload`
- **Catalogs** (5): `catalogs list/show/create/update/delete`
- **Product Items** (5): `product-items list/show/create/update/delete`
- **Product Sets** (5): `product-sets list/show/create/update/delete`
- **Insights** (1): `insights get`

### Direct API Client

For operations the CLI does not support, the agent calls the Marketing API directly via axios:

```typescript
class MetaAPIClient {
  private baseURL = "https://graph.facebook.com/v21.0";

  // Audiences — not available in CLI
  async createCustomAudience(params: CustomAudienceParams): Promise<Audience> { ... }
  async createLookalikeAudience(params: LookalikeParams): Promise<Audience> { ... }

  // Batch operations — not available in CLI
  async batchRequest(operations: BatchOperation[]): Promise<BatchResult[]> { ... }

  // A/B testing — not available in CLI
  async createSplitTest(params: SplitTestParams): Promise<SplitTest> { ... }

  // Ad rules — not available in CLI
  async createAdRule(params: AdRuleParams): Promise<AdRule> { ... }

  // Advanced targeting — CLI only supports country
  async getTargetingOptions(query: string): Promise<TargetingOption[]> { ... }
}
```

### Rate Limit Budget Tracker

Meta's Marketing API uses a Business Use Case (BUC) rate limiting system with per-account token budgets. The tracker:

1. Reads rate limit headers from every API response (`x-business-use-case-usage`)
2. Maintains a per-account budget (percentage of allocation consumed)
3. Blocks requests when budget exceeds 75% (configurable threshold)
4. Resets on the sliding window boundary
5. Applies to both CLI (via post-call header inspection) and direct API calls

### Token Storage

- **Local mode**: Stored in `~/.meta-ads-agent/config.json` with `0600` file permissions. Contains `access_token`, `ad_account_id`, `app_id`, and `app_secret`.
- **Cloud mode**: Read from environment variables (`META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_APP_ID`, `META_APP_SECRET`). Never written to disk.

---

## 5. Decision Engine

The decision engine translates performance data and goals into ranked action proposals.

### Goal Configuration Schema

```typescript
const GoalConfig = Type.Object({
  roasTarget: Type.Number({ minimum: 0, description: "Target ROAS (e.g., 4.0 = 400%)" }),
  cpaCap: Type.Number({ minimum: 0, description: "Maximum cost per acquisition" }),
  dailyBudgetLimit: Type.Number({ minimum: 0, description: "Max daily spend across all campaigns" }),
  riskLevel: Type.Union([
    Type.Literal("conservative"),
    Type.Literal("moderate"),
    Type.Literal("aggressive"),
  ], { default: "moderate" }),
});
```

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

Hard constraints that override the decision engine:

- **Minimum budget floor**: No campaign budget can be set below $5/day (configurable)
- **Max scale factor**: Budget cannot increase more than 2x per cycle (conservative), 3x (moderate), or 5x (aggressive)
- **Prohibited actions**: Cannot delete campaigns, cannot change campaign objectives, cannot modify payment settings
- **Spend velocity**: If daily spend exceeds 120% of `dailyBudgetLimit`, pause all scaling actions
- **Cool-down period**: After a major change (budget > 50% increase), wait 2 ticks before modifying the same entity

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

Every tool invocation is recorded in the `agent_decisions` table. This log is **append-only** — records are never updated or deleted.

### Table Schema

```sql
CREATE TABLE agent_decisions (
  id            TEXT PRIMARY KEY,          -- ULID
  timestamp     DATETIME NOT NULL,         -- When the action was taken
  session_id    TEXT NOT NULL,             -- Links to the agent session
  tool_name     TEXT NOT NULL,             -- Which tool was invoked
  tool_params   TEXT NOT NULL,             -- JSON: parameters passed to the tool
  llm_reasoning TEXT NOT NULL,             -- LLM's explanation for this action
  input_metrics TEXT NOT NULL,             -- JSON: performance data that informed the decision
  expected_outcome TEXT,                   -- JSON: what the agent predicted would happen
  actual_outcome   TEXT,                   -- JSON: what actually happened (filled on next tick)
  performance_delta TEXT,                  -- JSON: diff between expected and actual
  status        TEXT NOT NULL DEFAULT 'pending' -- pending | executed | failed | skipped
);
```

### Write Pattern

```typescript
// On tool invocation:
await auditLog.record({
  sessionId: session.id,
  toolName: "update_budget",
  toolParams: { campaignId: "123", dailyBudget: 50 },
  llmReasoning: "Campaign 123 has ROAS 5.2 (above target 4.0) with stable CPA...",
  inputMetrics: currentMetrics,
  expectedOutcome: { roas: 4.8, spend: 50 },
  status: "executed",
});

// On the NEXT tick, backfill actual outcomes:
await auditLog.backfillOutcomes(previousDecisionIds, actualMetrics);
```

**Important**: Never delete audit records. They form the ground truth for measuring agent effectiveness and debugging regressions. The `performance_delta` field enables the agent to learn from past decisions over time.

---

## 7. Database

### ORM and Migration

- **Drizzle ORM** for type-safe schema definitions and queries
- Migrations stored in `packages/core/src/db/migrations/`
- Migration files are generated via `drizzle-kit generate` and applied via `drizzle-kit migrate`

### Connection Factory

The database connection is created at startup based on the `DATABASE_MODE` environment variable:

```typescript
function createDatabase(mode: "sqlite" | "postgres"): Database {
  if (mode === "sqlite") {
    return drizzle(new BetterSqlite3("meta-ads-agent.db"));
  } else {
    return drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
  }
}
```

### Tables

- `agent_sessions` — Active/completed agent run sessions
- `agent_decisions` — Audit log (see section 6)
- `campaign_snapshots` — Point-in-time campaign performance snapshots
- `goal_configs` — User-defined optimization goals
- `rate_limit_state` — Per-account API rate limit tracking

### Migration Commands

```bash
# Generate a migration after schema changes
pnpm --filter @meta-ads-agent/core drizzle:generate

# Apply pending migrations
pnpm --filter @meta-ads-agent/core drizzle:migrate

# Drop and recreate (development only)
pnpm --filter @meta-ads-agent/core drizzle:reset
```

---

## 8. API (Dashboard Backend)

The dashboard backend is built with **Hono**, a lightweight, edge-compatible HTTP framework.

### Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Agent status (running/paused/stopped), current session info, last tick time |
| `GET` | `/decisions` | Paginated list of agent decisions with filters (date range, tool, status) |
| `GET` | `/campaigns` | Current campaign data with latest performance metrics |
| `POST` | `/control/pause` | Pause the agent loop (completes current tick, then stops) |
| `POST` | `/control/resume` | Resume the agent loop from paused state |
| `POST` | `/control/run` | Trigger an immediate OODA cycle (ad-hoc run) |

### Authentication

All routes require an `X-API-Key` header. The key is configured via the `DASHBOARD_API_KEY` environment variable. Invalid or missing keys return `401 Unauthorized`.

```typescript
app.use("*", async (c, next) => {
  const apiKey = c.req.header("X-API-Key");
  if (apiKey !== process.env.DASHBOARD_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
```

### Server Startup

The Hono server runs inside `packages/core` alongside the agent loop. Default port: `3000` (configurable via `DASHBOARD_PORT`).

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

These are specific failure modes identified during architecture analysis. Every contributor should be aware of them.

### Meta CLI Failure Patterns

1. **CLI process hangs**: The `meta ads` subprocess may hang on network issues. Always set a timeout on `spawn()` (default: 30 seconds). Kill the process and retry on timeout.

2. **JSON parse failures**: The CLI's `--output json` mode may emit warnings or progress text to stdout before the JSON payload. The parser must strip non-JSON prefixes and handle malformed output gracefully.

3. **Auth token expiry confusion**: System user tokens are permanent, but the underlying app may be deactivated or permissions revoked. Exit code 3 (auth error) should trigger a full token validation flow, not just a retry.

4. **Missing CLI capabilities assumed present**: The agent may attempt operations that require direct API access (audiences, batch ops, A/B testing) through the CLI. The tool system must route these to the direct API client, never to the CLI wrapper.

5. **Rate limit blindness**: The CLI does not expose rate limit headers. The rate limit tracker must parse headers from direct API calls AND estimate CLI-induced usage based on command frequency.

### Agent Loop Failure Patterns

6. **Stateless loop state leakage**: The core loop function must not capture mutable closures or module-level state. All state flows through function parameters. Violations break testability and create race conditions in concurrent usage.

7. **LLM hallucinated tool calls**: The LLM may generate tool calls with invalid parameter values (e.g., negative budgets, nonexistent campaign IDs). TypeBox schema validation catches type errors; business-logic validation (e.g., campaign existence) must also run before execution.

8. **Decision feedback loop amplification**: If the agent scales a well-performing campaign and performance subsequently dips (common after scaling), it may overcorrect by pausing the campaign entirely. The cool-down period and max scale factor guardrails exist specifically to prevent this oscillation.

9. **EventStream consumer abandonment**: If the async iterator of an EventStream is abandoned (loop breaks early), the underlying HTTP connection may leak. The `abort()` method must be called in `finally` blocks, and providers must handle abort gracefully (no unhandled promise rejections).

10. **Provider SDK version drift**: The Anthropic and OpenAI SDKs evolve rapidly. Pin exact versions in `package.json` and test against specific API behaviors. A new SDK version that changes streaming event shapes will silently break the provider implementation.

### Database Failure Patterns

11. **SQLite concurrent write contention**: SQLite in WAL mode handles concurrent reads well but can fail on concurrent writes. In local mode, ensure only one agent process writes at a time. Use a file lock or startup check.

12. **Migration ordering in dual-DB mode**: Drizzle migrations must be compatible with both SQLite and PostgreSQL dialects. Avoid Postgres-specific features (e.g., `JSONB`, array columns, `RETURNING *` without compatibility shims). Test migrations against both backends in CI.

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

| Package | Status | Description |
|---------|--------|-------------|
| `packages/core` | Implemented | Agent loop (OODA), tool system with TypeBox schemas, LLM adapters (Claude + OpenAI), decision engine with scoring and guardrails, Drizzle DB schema, audit logger, config loader |
| `packages/meta-client` | Implemented | Two-layer Meta client: CLI wrapper (spawns `meta-ads` Python CLI) + direct API client (axios to `graph.facebook.com/v21.0`). Rate limiter, error handling, 11 CLI command groups, 5 API endpoint modules |
| `packages/cli` | Implemented | Commander.js CLI with 8 commands: `init`, `run`, `run-once`, `status`, `report`, `pause`, `resume`, `config`. Daemon manager, Winston logging, interactive setup wizard |
| `packages/dashboard` | Implemented | React 18 + Vite + Tailwind dashboard with 5 pages (Overview, Decisions, Campaigns, Configuration, NotFound). Hono API server, Recharts, polling hooks, agent control buttons |

### Tool Domains

#### Campaign Management (`packages/core/src/tools/campaign/`)

| Tool Name | File | OODA Phase | Description |
|-----------|------|------------|-------------|
| `list_campaigns` | `list-campaigns.ts` | Observe | List all campaigns with current performance metrics |
| `pause_campaign` | `pause-campaign.ts` | Act | Pause a campaign by ID with audit logging |
| `scale_campaign` | `scale-campaign.ts` | Act | Scale campaign budget with guardrail enforcement |
| `create_campaign` | `create-campaign.ts` | Act | Create a new campaign from a structured spec |
| `duplicate_campaign` | `duplicate-campaign.ts` | Act | Copy a campaign structure (paused for review) |
| `ab_test_campaign` | `ab-test-campaign.ts` | Act | Create A/B split tests |
| `analyze_performance` | `analyze-performance.ts` | Orient | Analyze performance vs. agent goals (ROAS/CPA gaps) |

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

### Known TODOs (Areas for Future Contribution)

1. **End-to-end tests**: Integration tests with mocked Meta API (msw) and full agent loop
2. **Dashboard API authentication**: Wire up `X-API-Key` middleware in the Hono server
3. **Database migrations**: Add `drizzle-kit` migration generation and auto-run on startup
4. **Docker support**: Finish the multi-stage Docker build and docker-compose config
5. **Webhook receiver**: Add an endpoint for Meta's real-time update webhooks
6. **Multi-account support**: Allow managing multiple ad accounts from a single agent instance
7. **Custom tool plugins**: Allow users to add custom tools via a plugin directory
8. **Scheduling**: Add cron-style scheduling for report generation and creative analysis
9. **Cost tracking**: Track LLM API costs per agent cycle
10. **Rollback support**: Allow the agent to undo its last action if metrics worsen

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
