/**
 * @meta-ads-agent/core
 *
 * The central package of meta-ads-agent. Contains:
 *
 * - **Agent Loop** (`./agent/loop.ts`): Stateless OODA-cycle core function.
 *   Given state, tools, and an LLM provider, returns a list of actions.
 *   Wrapped by Agent (state management) and AgentSession (lifecycle, retry).
 *
 * - **Tool System** (`./tools/`): TypeBox-schema'd factory-function tools.
 *   Each tool is a plain object with name, description, parameters (TypeBox),
 *   and an async execute() method. Registered in a Map-based ToolRegistry.
 *
 * - **LLM Adapters** (`./llm/`): Pluggable LLMProvider interface with
 *   stream() and streamSimple() methods. EventStream<T,R> primitive supports
 *   async iteration and promise-based result extraction. Concrete providers:
 *   ClaudeProvider (Anthropic SDK), OpenAIProvider (OpenAI SDK).
 *
 * - **Decision Engine** (`./decision/`): Scores and ranks action proposals
 *   by (expected_impact * confidence) / risk. Enforces guardrails: budget
 *   floors, max scale factors, cool-down periods, prohibited actions.
 *
 * - **Database** (`./db/`): Drizzle ORM with dual-mode support — SQLite
 *   (better-sqlite3) for local, PostgreSQL (pg) for cloud. Selected via
 *   DATABASE_MODE env var. Includes agent_decisions audit table (append-only).
 *
 * - **API Server** (`./api/`): Hono HTTP server exposing /status, /decisions,
 *   /campaigns, /control/pause, /control/resume, /control/run. Authenticated
 *   via X-API-Key header.
 *
 * Architecture reference: see CLAUDE.md in the repository root.
 */

export {};
