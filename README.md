# meta-ads-agent

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-20%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)

**Open source autonomous agent for Meta Ads** — full lifecycle campaign management, creative generation, and budget optimization.

meta-ads-agent monitors your Meta (Facebook/Instagram) ad campaigns, analyzes performance trends, and takes action autonomously: scaling winners, pausing underperformers, adjusting budgets, and rotating creatives — all on a configurable schedule with full audit trails.

---

## Features

### Core Agent

- [x] OODA-cycle agent loop (Observe, Orient, Decide, Act)
- [x] Stateless core loop with stateful session wrapper
- [x] Configurable tick intervals and max iterations
- [x] Full audit trail — every decision is logged with reasoning and metrics
- [ ] Self-improving decisions based on outcome feedback

### Meta Integration

- [x] Official `meta-ads` CLI integration (47 commands across 11 resource groups)
- [x] Direct Marketing API client for advanced operations
- [ ] Custom Audience and Lookalike Audience management
- [ ] A/B test creation and monitoring
- [ ] Automated ad rules engine
- [ ] Batch operations for bulk changes
- [ ] Advanced targeting (interests, behaviors, demographics)

### LLM Support

- [x] Pluggable multi-model architecture
- [x] Claude (Anthropic) provider
- [x] GPT-4o (OpenAI) provider
- [ ] Add-your-own provider in <50 lines of code

### Decision Engine

- [x] Goal-based optimization (ROAS target, CPA cap, budget limits)
- [x] Action proposal ranking (impact x confidence / risk)
- [x] Safety guardrails (budget floors, scale caps, cool-down periods)
- [ ] Risk-level presets (conservative, moderate, aggressive)

### Dashboard

- [ ] Real-time agent status monitoring
- [ ] Decision log with reasoning and metrics
- [ ] Campaign performance visualization
- [ ] Manual agent controls (pause, resume, trigger run)

### Infrastructure

- [x] TypeScript monorepo with pnpm workspaces + Turborepo
- [x] Dual-mode database (SQLite local, PostgreSQL cloud)
- [x] GitHub Actions CI pipeline
- [x] Docker deployment for cloud environments
- [ ] Sentry error tracking integration

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Python 3.12+ (for Meta CLI)
- A Meta system user access token with required scopes

### Install and Run Locally

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/meta-ads-agent.git
cd meta-ads-agent

# Install dependencies
pnpm install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your Meta credentials and LLM API key

# Build all packages
pnpm build

# Run the agent
pnpm --filter meta-ads-agent start
```

### Run with npx (after publishing)

```bash
npx meta-ads-agent --account act_XXXXXXXXX --provider claude
```

### Run with Docker (cloud mode)

```bash
cd docker
cp ../.env.example .env
# Edit .env with your credentials (set DATABASE_MODE=postgres)
docker compose up -d
```

---

## Monorepo Structure

```
meta-ads-agent/
├── packages/
│   ├── core/           # Agent loop, tools, LLM adapters, DB, API server
│   ├── meta-client/    # Meta API client (CLI wrapper + direct API)
│   ├── cli/            # CLI application (publishable as npx package)
│   ├── dashboard/      # React web UI for monitoring and control
│   └── tsconfig/       # Shared TypeScript configuration
├── docker/             # Dockerfile and docker-compose for deployment
├── .github/workflows/  # CI pipeline
├── CLAUDE.md           # Full architecture reference
└── CONTRIBUTING.md     # Contributor guide
```

---

## Architecture

The agent runs on an **OODA cycle** (Observe-Orient-Decide-Act):

1. **Observe** — Pull live metrics from Meta (spend, ROAS, CPA, impressions)
2. **Orient** — LLM analyzes trends vs. goals, identifies opportunities and risks
3. **Decide** — Decision engine ranks proposals by `(impact x confidence) / risk`
4. **Act** — Execute top actions via tools, log everything to audit table

See [CLAUDE.md](CLAUDE.md) for the complete architectural reference, including tool system design, LLM adapter patterns, database schema, and known failure modes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Agent Core | TypeScript 5.6, TypeBox, EventStream |
| LLM | Anthropic SDK (Claude), OpenAI SDK (GPT-4o) |
| Meta | meta-ads CLI + Marketing API v21.0 |
| CLI | commander.js, inquirer, winston, chalk |
| Dashboard | React 18, Vite, Tailwind CSS, shadcn/ui, Recharts |
| Database | SQLite / PostgreSQL via Drizzle ORM |
| Build | Turborepo, pnpm workspaces |
| Test | Vitest, msw |
| CI | GitHub Actions |

---

## Requirements

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0
- **Python** >= 3.12 (for `meta-ads` CLI)
- **Meta system user token** with scopes: `business_management`, `ads_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `catalog_management`, `read_insights`
- **LLM API key**: Anthropic (Claude) or OpenAI (GPT-4o)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, branch naming conventions, PR requirements, and guides for adding new LLM providers and Meta tools.

---

## License

[MIT](LICENSE) -- 2026 meta-ads-agent Contributors
