/**
 * @module llm
 * LLM module barrel exports.
 *
 * Re-exports all public types, classes, and interfaces from the LLM
 * adapter layer for convenient single-import access.
 */

export { EventStream } from './stream.js';
export { LLMRegistry } from './registry.js';
export { ClaudeProvider } from './providers/claude.js';
export { OpenAIProvider } from './providers/openai.js';

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
} from './types.js';
