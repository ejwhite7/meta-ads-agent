/**
 * @module llm/types
 * LLM provider interface and related types.
 *
 * Defines the contract that all LLM providers must implement, along with
 * message types, stream event types, and tool definition formats used
 * for function calling across Claude and OpenAI providers.
 */

import type { EventStream } from './stream.js';

/**
 * Role of a message participant in a conversation.
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A single message in a multi-turn conversation.
 */
export interface Message {
  /** Role of the message sender */
  readonly role: MessageRole;

  /** Text content of the message */
  readonly content: string;

  /** Optional tool call ID (for tool result messages) */
  readonly toolCallId?: string;

  /** Optional tool name (for tool result messages) */
  readonly toolName?: string;
}

/**
 * Tool definition in a format suitable for LLM function calling.
 * Converted from TypeBox schemas to JSON Schema for API transmission.
 */
export interface ToolDefinition {
  /** Unique tool name (matches the Tool registry key) */
  readonly name: string;

  /** Human-readable description for the LLM */
  readonly description: string;

  /** JSON Schema describing the tool's parameters */
  readonly parameters: Record<string, unknown>;
}

/**
 * Discriminated union of events emitted during LLM streaming.
 * Consumers can switch on `event.type` for exhaustive handling.
 */
export type StreamEvent =
  | TextDeltaEvent
  | ToolCallStartEvent
  | ToolCallDeltaEvent
  | ToolCallEndEvent
  | ErrorEvent;

/** A chunk of text content from the LLM */
export interface TextDeltaEvent {
  readonly type: 'text_delta';
  /** Incremental text content */
  readonly text: string;
}

/** Signals the start of a tool/function call */
export interface ToolCallStartEvent {
  readonly type: 'tool_call_start';
  /** Unique ID for this tool call */
  readonly toolCallId: string;
  /** Name of the tool being called */
  readonly toolName: string;
}

/** A chunk of tool call argument JSON */
export interface ToolCallDeltaEvent {
  readonly type: 'tool_call_delta';
  /** Unique ID for this tool call */
  readonly toolCallId: string;
  /** Incremental JSON argument string */
  readonly argumentsDelta: string;
}

/** Signals the end of a tool call with complete arguments */
export interface ToolCallEndEvent {
  readonly type: 'tool_call_end';
  /** Unique ID for this tool call */
  readonly toolCallId: string;
  /** Fully assembled tool call arguments */
  readonly arguments: Record<string, unknown>;
}

/** An error that occurred during streaming */
export interface ErrorEvent {
  readonly type: 'error';
  /** Error details */
  readonly error: Error;
}

/**
 * Completed tool call extracted from an LLM response.
 */
export interface ToolCall {
  /** Unique ID for this tool call */
  readonly id: string;

  /** Name of the tool to invoke */
  readonly name: string;

  /** Parsed arguments for the tool */
  readonly arguments: Record<string, unknown>;
}

/**
 * Complete LLM response after stream consumption.
 */
export interface LLMResponse {
  /** Full text content from the response */
  readonly content: string;

  /** Tool calls requested by the LLM (empty array if none) */
  readonly toolCalls: ToolCall[];

  /** Token usage statistics */
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

/**
 * Unified LLM provider interface.
 *
 * All providers (Claude, OpenAI, etc.) implement this interface, enabling
 * the agent to switch between models without changing any calling code.
 * Providers return EventStream instances that support dual consumption:
 * async iteration for real-time streaming AND promise-based result extraction.
 */
export interface LLMProvider {
  /** Provider name (e.g., "claude", "openai") */
  readonly name: string;

  /** Model identifier (e.g., "claude-opus-4-5", "gpt-4o") */
  readonly model: string;

  /**
   * Stream a multi-turn conversation with optional tool use.
   *
   * Returns an EventStream that emits StreamEvents (text deltas, tool calls)
   * and resolves to a complete LLMResponse when the stream finishes.
   *
   * @param messages - Conversation history
   * @param tools - Available tool definitions for function calling
   * @returns EventStream of streaming events, resolving to full response
   */
  stream(messages: Message[], tools: ToolDefinition[]): EventStream<StreamEvent, LLMResponse>;

  /**
   * Stream a simple text-in/text-out completion (no tools).
   *
   * Convenience method for prompts that don't need function calling.
   * Returns an EventStream of string chunks that resolves to the full text.
   *
   * @param prompt - The user prompt
   * @param systemPrompt - Optional system prompt for context
   * @returns EventStream of text chunks, resolving to full text string
   */
  streamSimple(prompt: string, systemPrompt?: string): EventStream<string, string>;
}

/**
 * Factory function type for lazy provider instantiation.
 * The LLM registry stores these factories and only calls them on first use.
 */
export type LLMProviderFactory = () => LLMProvider;
