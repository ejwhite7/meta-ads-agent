/**
 * @module llm/providers/openai
 * OpenAI LLM provider implementation.
 *
 * Wraps the OpenAI SDK to implement the LLMProvider interface.
 * Maps TypeBox-derived tool schemas to OpenAI's function calling format
 * and handles streaming via the OpenAI chat completions API.
 */

import OpenAI from "openai";
import { EventStream } from "../stream.js";
import type {
	LLMProvider,
	LLMResponse,
	Message,
	StreamEvent,
	ToolCall,
	ToolDefinition,
} from "../types.js";

/** Maximum number of retries for rate-limited requests */
const MAX_RATE_LIMIT_RETRIES = 3;

/** Base delay in milliseconds for rate limit backoff */
const RATE_LIMIT_BASE_DELAY_MS = 1000;

/**
 * Converts a ToolDefinition to OpenAI's function calling format.
 *
 * @param tool - Generic tool definition with JSON Schema parameters
 * @returns OpenAI-formatted chat completion tool
 */
function toOpenAITool(tool: ToolDefinition): OpenAI.Chat.Completions.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	};
}

/**
 * Converts our Message format to OpenAI's message format.
 *
 * @param messages - Array of conversation messages
 * @returns Array of OpenAI-formatted messages
 */
function toOpenAIMessages(
	messages: Message[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
	return messages.map((msg): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
		switch (msg.role) {
			case "system":
				return { role: "system", content: msg.content };
			case "user":
				return { role: "user", content: msg.content };
			case "assistant":
				return { role: "assistant", content: msg.content };
			case "tool":
				return {
					role: "tool",
					content: msg.content,
					tool_call_id: msg.toolCallId ?? "",
				};
			default:
				return { role: "user", content: msg.content };
		}
	});
}

/**
 * Pauses execution for the specified duration.
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the delay
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenAI LLM provider using the official OpenAI SDK.
 *
 * Implements the LLMProvider interface with full support for:
 * - Multi-turn conversation streaming
 * - Function/tool calling via OpenAI's tool use API
 * - Rate limit handling with exponential backoff
 * - Simple text completion streaming
 *
 * @example
 * ```ts
 * const provider = new OpenAIProvider({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'gpt-4o',
 * });
 *
 * const stream = provider.stream(messages, tools);
 * for await (const event of stream) {
 *   console.log(event);
 * }
 * const response = await stream.result();
 * ```
 */
export class OpenAIProvider implements LLMProvider {
	/** Provider identifier */
	readonly name = "openai";

	/** Model identifier (e.g., "gpt-4o", "gpt-4o-mini") */
	readonly model: string;

	/** OpenAI SDK client instance */
	private readonly client: OpenAI;

	/** Maximum tokens to generate per response */
	private readonly maxTokens: number;

	/**
	 * Creates a new OpenAIProvider.
	 *
	 * @param config - Provider configuration
	 * @param config.apiKey - OpenAI API key
	 * @param config.model - Model identifier (default: "gpt-4o")
	 * @param config.maxTokens - Max tokens per response (default: 4096)
	 */
	constructor(config: {
		apiKey: string;
		model?: string;
		maxTokens?: number;
	}) {
		this.client = new OpenAI({ apiKey: config.apiKey });
		this.model = config.model ?? "gpt-4o";
		this.maxTokens = config.maxTokens ?? 4096;
	}

	/**
	 * Streams a multi-turn conversation with optional tool use.
	 *
	 * Connects to the OpenAI streaming API and emits StreamEvents
	 * for text deltas and tool calls. The stream resolves to a complete
	 * LLMResponse with full text, tool calls, and usage statistics.
	 *
	 * @param messages - Conversation history
	 * @param tools - Available tool definitions for function calling
	 * @returns EventStream emitting StreamEvents, resolving to LLMResponse
	 */
	stream(messages: Message[], tools: ToolDefinition[]): EventStream<StreamEvent, LLMResponse> {
		const eventStream = new EventStream<StreamEvent, LLMResponse>();

		this.executeStream(messages, tools, eventStream, 0).catch((err: unknown) => {
			const error = err instanceof Error ? err : new Error(String(err));
			try {
				eventStream.error(error);
			} catch {
				/* Stream may already be completed/errored — ignore */
			}
		});

		return eventStream;
	}

	/**
	 * Streams a simple text-in/text-out completion without tool calling.
	 *
	 * @param prompt - The user prompt
	 * @param systemPrompt - Optional system prompt for context
	 * @returns EventStream of text chunks, resolving to the full text
	 */
	streamSimple(prompt: string, systemPrompt?: string): EventStream<string, string> {
		const eventStream = new EventStream<string, string>();

		const messages: Message[] = [];
		if (systemPrompt) {
			messages.push({ role: "system", content: systemPrompt });
		}
		messages.push({ role: "user", content: prompt });

		this.executeSimpleStream(messages, eventStream, 0).catch((err: unknown) => {
			const error = err instanceof Error ? err : new Error(String(err));
			try {
				eventStream.error(error);
			} catch {
				/* Stream may already be completed/errored — ignore */
			}
		});

		return eventStream;
	}

	/**
	 * Internal method that executes the OpenAI streaming API call
	 * with rate limit retry support.
	 *
	 * @param messages - Conversation messages
	 * @param tools - Tool definitions
	 * @param eventStream - Target event stream for events and result
	 * @param retryCount - Current retry attempt (0-based)
	 */
	private async executeStream(
		messages: Message[],
		tools: ToolDefinition[],
		eventStream: EventStream<StreamEvent, LLMResponse>,
		retryCount: number,
	): Promise<void> {
		const openaiMessages = toOpenAIMessages(messages);
		const openaiTools = tools.map(toOpenAITool);

		try {
			const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
				model: this.model,
				max_tokens: this.maxTokens,
				messages: openaiMessages,
				stream: true,
				stream_options: { include_usage: true },
				...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
			};

			const response = await this.client.chat.completions.create(params);

			let fullText = "";
			const toolCalls: ToolCall[] = [];
			const toolCallArgBuffers: Map<number, { id: string; name: string; args: string }> = new Map();
			let promptTokens = 0;
			let completionTokens = 0;

			for await (const chunk of response) {
				const delta = chunk.choices[0]?.delta;

				if (!delta) {
					/* Usage chunk at the end of stream */
					if (chunk.usage) {
						promptTokens = chunk.usage.prompt_tokens;
						completionTokens = chunk.usage.completion_tokens;
					}
					continue;
				}

				/* Handle text content deltas */
				if (delta.content) {
					fullText += delta.content;
					eventStream.push({ type: "text_delta", text: delta.content });
				}

				/* Handle tool call deltas */
				if (delta.tool_calls) {
					for (const toolCallDelta of delta.tool_calls) {
						const idx = toolCallDelta.index;

						if (toolCallDelta.id) {
							/* Start of a new tool call */
							toolCallArgBuffers.set(idx, {
								id: toolCallDelta.id,
								name: toolCallDelta.function?.name ?? "",
								args: toolCallDelta.function?.arguments ?? "",
							});

							eventStream.push({
								type: "tool_call_start",
								toolCallId: toolCallDelta.id,
								toolName: toolCallDelta.function?.name ?? "",
							});
						} else {
							/* Continuation of an existing tool call */
							const existing = toolCallArgBuffers.get(idx);
							if (existing && toolCallDelta.function?.arguments) {
								existing.args += toolCallDelta.function.arguments;
								eventStream.push({
									type: "tool_call_delta",
									toolCallId: existing.id,
									argumentsDelta: toolCallDelta.function.arguments,
								});
							}
						}
					}
				}

				/* Capture usage from the final chunk */
				if (chunk.usage) {
					promptTokens = chunk.usage.prompt_tokens;
					completionTokens = chunk.usage.completion_tokens;
				}
			}

			/* Finalize all tool calls */
			for (const [, buffer] of toolCallArgBuffers) {
				let parsedArgs: Record<string, unknown> = {};
				try {
					parsedArgs = JSON.parse(buffer.args) as Record<string, unknown>;
				} catch {
					parsedArgs = { _raw: buffer.args };
				}

				toolCalls.push({
					id: buffer.id,
					name: buffer.name,
					arguments: parsedArgs,
				});

				eventStream.push({
					type: "tool_call_end",
					toolCallId: buffer.id,
					arguments: parsedArgs,
				});
			}

			eventStream.complete({
				content: fullText,
				toolCalls,
				usage: {
					promptTokens,
					completionTokens,
					totalTokens: promptTokens + completionTokens,
				},
			});
		} catch (err: unknown) {
			if (this.isRateLimitError(err) && retryCount < MAX_RATE_LIMIT_RETRIES) {
				const backoff = RATE_LIMIT_BASE_DELAY_MS * 2 ** retryCount;
				console.warn(
					`[OpenAIProvider] Rate limited — retrying in ${backoff}ms (attempt ${retryCount + 1})`,
				);
				await delay(backoff);
				return this.executeStream(messages, tools, eventStream, retryCount + 1);
			}

			throw err;
		}
	}

	/**
	 * Internal method that executes a simple streaming completion
	 * with rate limit retry support.
	 *
	 * @param messages - Conversation messages
	 * @param eventStream - Target event stream for text chunks
	 * @param retryCount - Current retry attempt (0-based)
	 */
	private async executeSimpleStream(
		messages: Message[],
		eventStream: EventStream<string, string>,
		retryCount: number,
	): Promise<void> {
		const openaiMessages = toOpenAIMessages(messages);

		try {
			const response = await this.client.chat.completions.create({
				model: this.model,
				max_tokens: this.maxTokens,
				messages: openaiMessages,
				stream: true,
			});

			let fullText = "";

			for await (const chunk of response) {
				const content = chunk.choices[0]?.delta?.content;
				if (content) {
					fullText += content;
					eventStream.push(content);
				}
			}

			eventStream.complete(fullText);
		} catch (err: unknown) {
			if (this.isRateLimitError(err) && retryCount < MAX_RATE_LIMIT_RETRIES) {
				const backoff = RATE_LIMIT_BASE_DELAY_MS * 2 ** retryCount;
				console.warn(
					`[OpenAIProvider] Rate limited — retrying in ${backoff}ms (attempt ${retryCount + 1})`,
				);
				await delay(backoff);
				return this.executeSimpleStream(messages, eventStream, retryCount + 1);
			}

			throw err;
		}
	}

	/**
	 * Checks whether an error is a rate limit error (HTTP 429).
	 *
	 * @param err - The error to check
	 * @returns True if the error is a rate limit error
	 */
	private isRateLimitError(err: unknown): boolean {
		if (err && typeof err === "object" && "status" in err) {
			return (err as { status: number }).status === 429;
		}
		return false;
	}
}
