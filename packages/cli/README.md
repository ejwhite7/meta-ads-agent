# meta-ads-agent

Open-source autonomous agent for Meta (Facebook / Instagram) advertising. Manages the full campaign lifecycle — creation, optimization, budget allocation, creative rotation, audience management, and reporting — on a configurable schedule.

> ⚠️ **Alpha software.** First public release. Run `--dry-run` for a few cycles before letting it touch real money.

## Install

```bash
npm i -g meta-ads-agent
# or run without installing
npx meta-ads-agent init
```

Requires **Node.js 20+**. No Python runtime needed — all Meta integration goes through the Marketing API directly.

## Quick start

```bash
meta-ads-agent init             # interactive setup wizard
meta-ads-agent run --dry-run    # safe first session: log proposals, do not execute
meta-ads-agent run              # start the agent loop
```

The wizard collects:

1. A **Meta access token** (system-user token from <https://business.facebook.com/settings/system-users>) with these scopes:
   - `business_management`, `ads_management`, `ads_read`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `read_insights`
2. The **ad account ID** to manage (`act_XXXXXXXXX`).
3. An **LLM provider** — Claude (Anthropic) or GPT-4o (OpenAI) — and the corresponding API key.
4. **Optimization goals**: target ROAS, CPA cap, daily budget limit, risk level.
5. **Guardrails**: minimum daily budget, maximum scale factor per cycle, approval threshold above which budget changes pause for human sign-off.

Configuration is stored at `~/.meta-ads-agent/config.json` with `0o600` permissions.

## Commands

| Command | Description |
|---|---|
| `init` | Interactive setup wizard |
| `run` | Start the agent loop (daemon mode, scheduled OODA cycles) |
| `run-once` | Execute a single OODA tick and exit |
| `status` | Show current agent state and recent decisions |
| `decisions` | Pretty-print the audit log with filtering (added in 0.1.1) |
| `dashboard` | Launch the web UI + API on a single port (added in 0.1.2) |
| `report` | Generate a performance summary for a date range |
| `pause` | Pause a running agent session |
| `resume` | Resume a paused agent session |
| `config` | View or edit agent configuration |

Run any command with `--help` for full usage.

### Dashboard

The `dashboard` command serves a React UI plus REST API on one port (default `3001`):

```bash
DASHBOARD_API_KEY=$(openssl rand -hex 16) meta-ads-agent dashboard
# Auto-opens http://localhost:3001 in your browser.
```

Flags:

| Flag | Description |
|---|---|
| `--port <n>` | Port to listen on (default `3001`) |
| `--no-open` | Don't auto-open the browser |
| `--api-key <key>` | Override the `DASHBOARD_API_KEY` env var |

The dashboard reads from the same SQLite/Postgres audit DB the agent writes to, plus connects to the running daemon over the IPC socket for live status. It refuses to start without an API key unless you explicitly set `DASHBOARD_AUTH=none` (local dev only).

## How it works

Every tick is one OODA cycle:

1. **Observe** — pull live performance metrics from Meta's Marketing API.
2. **Orient** — feed metrics + goals to the LLM. Identify underperformers, scaling opportunities, anomalies.
3. **Decide** — score and rank proposed actions by `(expected_impact × confidence) / risk`. Apply guardrails: minimum budget floor, max scale factor, mandatory approval threshold.
4. **Act** — execute approved actions. Log every decision (input metrics, LLM reasoning, parameters, outcome) to an append-only audit trail.

Tools the agent can invoke:

- **Campaign**: list, pause, scale, create, duplicate, A/B test, analyze performance
- **Budget**: status, pacing alerts, set/reallocate, optimize bids, project spend
- **Creative**: generate ad copy, create/rotate/retire creatives, analyze fatigue, image-prompt generation, clone top performers
- **Reporting**: campaign metrics, performance reports (JSON/Markdown/CSV), anomaly detection, Slack notifications, attribution stats

## Safety

Pending actions (proposals exceeding the configured approval threshold) are **never auto-executed**. They land in the audit log and the dashboard for human sign-off. The agent halts itself after three consecutive audit-log persistence failures (the audit trail is the system of record — no records, no execution).

## Environment variables

The wizard writes a config file, but everything is also configurable via env. See [`.env.example`](https://github.com/ejwhite7/meta-ads-agent/blob/main/.env.example) for the full list. Key ones:

| Variable | Description |
|---|---|
| `META_ACCESS_TOKEN` | Meta system-user access token |
| `META_AD_ACCOUNT_ID` | `act_XXXXXXXXX` |
| `LLM_PROVIDER` | `claude` or `openai` (default: `claude`) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Per-provider credentials |
| `DATABASE_MODE` | `sqlite` (default) or `postgres` |
| `DASHBOARD_API_KEY` | Required when running the dashboard server |

## License

MIT — see [LICENSE](./LICENSE).

## Repository

- **Source**: <https://github.com/ejwhite7/meta-ads-agent>
- **Issues**: <https://github.com/ejwhite7/meta-ads-agent/issues>
- **Architecture**: see [`CLAUDE.md`](https://github.com/ejwhite7/meta-ads-agent/blob/main/CLAUDE.md) in the repo for the full design reference.
