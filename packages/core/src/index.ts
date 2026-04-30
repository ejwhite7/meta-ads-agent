/**
 * @module @meta-ads-agent/core
 * Public API for the meta-ads-agent core package.
 *
 * Re-exports all public types, classes, interfaces, and functions from
 * the core modules: agent loop, tool system, LLM adapters, decision engine,
 * database, audit logging, and configuration.
 *
 * This is the single entry point for all consumers of the core package.
 */

/* === Core Types === */
export type { AgentGoal, CampaignMetrics, AgentAction } from './types.js';

/* === Agent Loop & Session === */
export { runAgentLoop } from './agent/loop.js';
export { AgentSession } from './agent/session.js';
export type {
  AgentLoopContext,
  AgentLoopResult,
  MetricsSummary,
  SessionStatus,
  AgentSessionConfig,
  SessionResult,
} from './agent/types.js';

/* === Tool System === */
export { createTool, ToolExecutionError } from './tools/types.js';
export type { Tool, ToolContext, ToolResult } from './tools/types.js';
export { ToolRegistry } from './tools/registry.js';
export { ToolExecutor } from './tools/executor.js';
export type { ExecutorConfig } from './tools/executor.js';
export { HookManager } from './tools/hooks.js';
export type { BeforeHook, AfterHook } from './tools/hooks.js';

/* === Budget Tools === */
export { createBudgetTools } from './tools/index.js';
export {
  createGetBudgetStatusTool,
  createGetPacingAlertsTool,
  createSetBudgetTool,
  createReallocateBudgetTool,
  createOptimizeBidsTool,
  createProjectSpendTool,
} from './tools/budget/index.js';
export type {
  PacingStatus,
  PacingAlert,
  AlertSeverity,
  ProjectionConfidence,
} from './tools/budget/index.js';

/* === LLM Adapters === */
export {
  EventStream,
  LLMRegistry,
  ClaudeProvider,
  OpenAIProvider,
} from './llm/index.js';
export type {
  LLMProvider,
  LLMProviderFactory,
  LLMResponse,
  Message,
  MessageRole,
  StreamEvent,
  TextDeltaEvent,
  ToolCallStartEvent,
  ToolCallDeltaEvent,
  ToolCallEndEvent,
  ErrorEvent,
  ToolDefinition,
  ToolCall,
} from './llm/index.js';

/* === Decision Engine === */
export { proposeActions, parseActions, applyGuardrails } from './decisions/engine.js';
export { scoreAction, scoreProposal, rankProposals } from './decisions/scoring.js';
export { DEFAULT_GUARDRAILS } from './decisions/types.js';
export type {
  ActionProposal,
  GuardrailConfig,
  RawProposedAction,
} from './decisions/types.js';

/* === Database === */
export { createDatabase, createDatabaseAsync } from './db/index.js';
export type { DatabaseType, DatabaseConfig, DatabaseConnection } from './db/index.js';
export {
  agentSessions,
  agentDecisions,
  campaignSnapshots,
  agentConfig,
} from './db/schema.js';

/* === Audit Logging === */
export { AuditLogger } from './audit/logger.js';
export type { AuditDatabase } from './audit/logger.js';
export type { AuditRecord, AuditFilter } from './audit/types.js';

/* === Configuration === */
export { loadConfig } from './config/index.js';
export { AgentConfigSchema } from './config/types.js';
export type { AgentConfig, AgentConfigInput } from './config/types.js';
