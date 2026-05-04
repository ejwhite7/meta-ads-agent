# meta-ads-agent

An open-source autonomous agent for Meta (Facebook / Instagram) advertising. Pulls live performance data, reasons about it with an LLM, applies guardrailed actions to your campaigns, and grades its own decisions on the next tick.

> ⚠️ **Alpha (`0.2.x`).** Designed to run safely in `--dry-run` indefinitely. Drop the flag once you trust it on your account. Every action is recorded to an append-only audit log; nothing is silent.

## What it does

| Capability | How |
|---|---|
| **Per-campaign optimization** | Each campaign has its own goal (ROAS / CPA / CPL / CPC / CPM / cost-per-thruplay / etc.). Agent refuses to act on unconfigured campaigns and surfaces them for human guidance. |
| **OODA tick loop** | Every interval (default 1h): pulls insights → grades prior decisions → asks LLM what to do → applies guardrailed actions. |
| **Outcome backfill** | After each tick, fills in `actual_outcome` + `performance_delta` for previously-successful decisions so you can see what worked. |
| **Guardrails** | Min daily budget, max scale-factor per cycle, mandatory approval threshold (account-wide defaults, per-campaign overrides). |
| **Audit log** | Append-only. Every decision, every reasoning trace, every parameter, every outcome — queryable via CLI or dashboard. |
| **Dashboard** | Bundled React UI with date-range filtering, served from the CLI binary on a single port. |
| **Multi-LLM** | Claude (Anthropic) or GPT-4o (OpenAI) via a pluggable provider interface. |

## Quick start

```bash
# install
npm i -g meta-ads-agent           # or: pnpm i -g meta-ads-agent
# (or run without installing: npx meta-ads-agent <command>)

# one-time setup wizard
meta-ads-agent init               # collects token + ad account + LLM key
                                  # + per-campaign goal configuration

# add goals for any campaign that doesn't have one yet
meta-ads-agent guidance           # walks through unconfigured campaigns

# safe first run
meta-ads-agent run --dry-run --interval 5
                                  # ticks every 5 minutes, logs decisions
                                  # without modifying real campaigns

# see what it's been thinking
meta-ads-agent decisions --limit 20
meta-ads-agent decisions --tool set_budget --full

# launch the dashboard (web UI + API on :3001)
DASHBOARD_API_KEY=$(openssl rand -hex 16) meta-ads-agent dashboard
```

Requires **Node.js 20+**. No Python needed — all Meta integration goes through the Marketing API directly via `axios`.

## Architecture (one paragraph)

TypeScript monorepo, four packages: **`core`** holds the OODA loop, decision engine, audit logger, per-campaign goal repository, snapshot writer, backfill engine, and Drizzle SQLite/Postgres schema. **`meta-client`** is the direct Marketing API client (`graph.facebook.com/v21.0`). **`cli`** is the publishable `meta-ads-agent` binary — bundled by tsup, ships the React **`dashboard`** assets inside its tarball so `meta-ads-agent dashboard` works out of the box. State (config, daemon socket, SQLite DB) lives in `~/.meta-ads-agent/`.

For depth: **[CLAUDE.md](CLAUDE.md)** is the canonical architectural reference. **[DESIGN.md](DESIGN.md)** explains *why* the codebase is shaped the way it is.

## Configuration

The `init` wizard writes `~/.meta-ads-agent/config.json` with `0o600` permissions. Everything is also configurable via env vars — see **[`.env.example`](.env.example)**.

| Variable | Description |
|---|---|
| `META_ACCESS_TOKEN` | Meta system-user access token (scopes: `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `read_insights`) |
| `META_AD_ACCOUNT_ID` | `act_XXXXXXXXX` |
| `LLM_PROVIDER` | `claude` (default) or `openai` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Per-provider credentials |
| `DATABASE_MODE` | `sqlite` (default) or `postgres` |
| `SQLITE_PATH` | Default `~/.meta-ads-agent/agent.db` |
| `DASHBOARD_API_KEY` | Required for the dashboard server (refuses to start without it unless `DASHBOARD_AUTH=none`) |

**Per-campaign goals** are stored in the SQLite/Postgres database, not env. Configure via `meta-ads-agent guidance` or in the `init` wizard.

## CLI commands

```
meta-ads-agent init              Interactive setup wizard
meta-ads-agent run [--dry-run] [--interval N]
                                 Start the agent loop (daemon)
meta-ads-agent run-once [--dry-run]
                                 One OODA tick + exit
meta-ads-agent guidance          Configure per-campaign goals (or
                                 --list / --show / --reset / --all)
meta-ads-agent status            Current agent state
meta-ads-agent decisions         Audit log (with filters)
meta-ads-agent dashboard         Launch web UI + API on one port
meta-ads-agent report [--days N] Performance summary
meta-ads-agent pause / resume    Pause / resume a running daemon
meta-ads-agent config            View / edit configuration
```

Run any with `--help` for full usage.

## Safety

- **Refuses to act on unconfigured campaigns.** If a campaign has no entry in the goal store, it's recorded as `_pending_guidance` in the audit log and *no decision is made on it*. Configure with `meta-ads-agent guidance`.
- **Pending actions** (proposals exceeding the configured approval threshold) are recorded but never auto-executed. They surface in `decisions --tool _pending_human_approval` and the dashboard.
- **Audit-log halt.** The session halts itself after **3 consecutive audit-log persistence failures** — the audit trail is the system of record; we don't run blind.
- **Dashboard auth fails closed.** The server refuses to start without `DASHBOARD_API_KEY` (or explicit `DASHBOARD_AUTH=none` for local dev).

## Status

`0.2.x` alpha. Smoke-tested end-to-end against real Meta accounts. Not yet load-tested against accounts with hundreds of campaigns. The dashboard's Campaigns page and a few legacy tool implementations have known rough edges tracked in GitHub issues.

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup and PR conventions, and **[AGENTS.md](AGENTS.md)** if you're an AI tool (Claude Code / Cursor / Aider / etc.) working on the codebase — it's a focused quick-orientation guide.

## License

MIT — see [LICENSE](LICENSE).

## Repository

- **Issues**: <https://github.com/ejwhite7/meta-ads-agent/issues>
- **Architecture**: [CLAUDE.md](CLAUDE.md) · [DESIGN.md](DESIGN.md) · [AGENTS.md](AGENTS.md)
