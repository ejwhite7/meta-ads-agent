# meta-ads-agent

An open source autonomous agent for Meta (Facebook/Instagram) ads. Powered by Claude and GPT-4o, it autonomously manages campaigns, optimizes budgets, generates creative, and reports on performance — all without human intervention.

## Features

- **Campaign Management**: Create, pause, scale, and A/B test campaigns autonomously
- **Budget Optimization**: Real-time reallocation, pacing alerts, bid strategy tuning
- **Creative Generation**: LLM-powered ad copy and image prompts, creative rotation, performance-based retirement
- **Reporting & Anomaly Detection**: Automated reports, CPA spike detection, Slack alerts
- **Multi-Model LLM**: Pluggable adapter for Claude (Anthropic), GPT-4o (OpenAI), or local models
- **Guardrails**: Configurable spend limits, approval thresholds, and kill switches

## Architecture

TypeScript monorepo with 4 packages:

| Package | Purpose |
|---------|---------|
| `packages/core` | Agent loop (OODA), tool system, LLM adapters, decision engine |
| `packages/meta-client` | Typed Meta Ads CLI/API client |
| `packages/cli` | Command-line interface |
| `packages/dashboard` | React web dashboard |

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm 9+
- Meta developer app with Marketing API access

### Installation

```bash
git clone https://github.com/ejwhite7/meta-ads-agent
cd meta-ads-agent
pnpm install
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your Meta API credentials and LLM API keys
```

### Run

```bash
# Initialize (interactive setup)
pnpm cli init

# Run the agent (single cycle)
pnpm cli run

# Run as a daemon (continuous)
pnpm cli run --daemon --interval 3600

# View status
pnpm cli status
```

### Dashboard

```bash
pnpm --filter dashboard dev
# Open http://localhost:5173
```

## Configuration

See `.env.example` for all environment variables. Key settings:

| Variable | Description |
|----------|-------------|
| `META_ACCESS_TOKEN` | Meta system user token |
| `META_AD_ACCOUNT_ID` | Ad account ID (act_XXXXXXXXXX) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `OPENAI_API_KEY` | GPT-4o API key |
| `LLM_PROVIDER` | `claude` or `openai` (default: `claude`) |
| `AGENT_TARGET_ROAS` | Target return on ad spend |
| `AGENT_CPA_CAP` | Maximum acceptable cost per acquisition |
| `AGENT_MIN_DAILY_BUDGET` | Minimum campaign daily budget |
| `AGENT_MAX_BUDGET_SCALE` | Max budget increase per cycle (e.g., 1.5 = 50%) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
