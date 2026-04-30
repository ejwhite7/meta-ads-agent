#!/usr/bin/env node

/**
 * meta-ads-agent CLI
 *
 * Entry point for the command-line interface. This is the publishable package
 * that users install via `npx meta-ads-agent` or `npm install -g meta-ads-agent`.
 *
 * CLI Structure (commander.js):
 *
 *   meta-ads-agent start         Start the agent loop (runs OODA cycles on schedule)
 *   meta-ads-agent run           Run a single OODA cycle and exit
 *   meta-ads-agent status        Show current agent status and last decisions
 *   meta-ads-agent config        Interactive configuration setup (inquirer prompts)
 *   meta-ads-agent dashboard     Start the dashboard API server
 *   meta-ads-agent migrate       Run database migrations
 *
 * Global flags:
 *   --account <id>      Meta ad account ID (overrides META_AD_ACCOUNT_ID env)
 *   --provider <name>   LLM provider: claude | openai (overrides LLM_PROVIDER env)
 *   --model <name>      LLM model identifier (overrides LLM_MODEL env)
 *   --dry-run           Log actions without executing them
 *   --verbose           Enable debug-level logging
 *   --json              Output results as JSON
 *
 * Logging: winston with console transport (colorized via chalk).
 * In --json mode, structured JSON logs are emitted to stdout.
 *
 * Architecture reference: see CLAUDE.md in the repository root.
 */

console.log("meta-ads-agent: not yet implemented — see CLAUDE.md for architecture reference");
