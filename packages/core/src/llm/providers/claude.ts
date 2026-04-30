/**
 * @module llm/providers/claude
 * Claude (Anthropic) LLM provider implementation.
 *
 * Wraps the @anthropic-ai/sdk to implement the LLMProvider interface.
 * Handles streaming responses, function/tool calling, and rate limit
 * errors with automatic exponential backoff.
 */

import Anthropic from "@anthropic-ai/sdk";
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
 * Converts a ToolDefinition to Anthropic's tool format.
 *
 * @param tool - Generic tool definition with JSON Schema parameters
 * @returns Anthropic-formatted tool specification
 */
function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
	return {
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters as Anthropic.Tool["input_schema"],
	};
}

/**
 * Converts our Message format to Anthropic's message format.
 * Anthropic uses a separate system parameter, so system messages
 * are extracted and the rest are mapped to MessageParam array.
 *
 * @param messages - Array of conversation messages
 * @returns Tuple of [systemPrompt, anthropicMessages]
 */
function toAnthropicMessages(messages: Message[]): [string | undefined, Anthropic.MessageParam[]] {
	let systemPrompt: string | undefined;
	const anthropicMessages: Anthropic.MessageParam[] = [];

	for (const msg of messages) {
		if (msg.role === "system") {
			systemPrompt = msg.content;
			continue;
		}

		if (msg.role === "tool") {
			anthropicMessages.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: msg.toolCallId ?? "",
						content: msg.content,
					},
				],
			});
			continue;
		}

		anthropicMessages.push({
			role: msg.role === "user" ? "user" : "assistant",
			content: msg.content,
		});
	}

	return [systemPrompt, anthropicMessages];
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
 * Claude LLM provider using the Anthropic SDK.
 *
 * Implements the LLMProvider interface with full support for:
 * - Multi-turn conversation streaming
 * - Function/tool calling via Anthropic's tool use API
 * - Rate limit handling with exponential backoff
 * - Simple text completion streaming
 *
 * @example
 * ```ts
 * const provider = new ClaudeProvider({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   model: 'claude-sonnet-4-20250514',
 * });
 *
 * const stream = provider.stream(messages, tools);
 * for await (const event of stream) {
 *   console.log(event);
 * }
 * const response = await stream.result();
 * ```
 */
export class ClaudeProvider implements LLMProvider {
	/** Provider identifier */
	readonly name = "claude";

	/** Model identifier (e.g., "claude-opus-4-5", "claude-sonnet-4-20250514") */
	readonly model: string;

	/** Anthropic SDK client instance */
	private readonly client: Anthropic;

	/** Maximum tokens to generate per response */
	private readonly maxTokens: number;

	/**
	 * Creates a new ClaudeProvider.
	 *
	 * @param config - Provider configuration
	 * @param config.apiKey - Anthropic API key
	 * @param config.model - Model identifier (default: "claude-sonnet-4-20250514")
	 * @param config.maxTokens - Max tokens per response (default: 4096)
	 */
	constructor(config: {
		apiKey: string;
		model?: string;
		maxTokens?: number;
	}) {
		this.client = new Anthropic({ apiKey: config.apiKey });
		this.model = config.model ?? "claude-sonnet-4-20250514";
		this.maxTokens = config.maxTokens ?? 4096;
	}

	/**
	 * Streams a multi-turn conversation with optional tool use.
	 *
	 * Connects to the Anthropic streaming API and emits StreamEvents
	 * for text deltas and tool calls. The stream resolves to a complete
	 * LLMResponse with full text, tool calls, and usage statistics.
	 *
	 * Handles rate limit errors (HTTP 429) with exponential backoff,
	 * retrying up to MAX_RATE_LIMIT_RETRIES times.
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
	 * Internal method that executes the Anthropic streaming API call
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
		const [systemPrompt, anthropicMessages] = toAnthropicMessages(messages);
		const anthropicTools = tools.map(toAnthropicTool);

		try {
			const params: Anthropic.MessageCreateParams = {
				model: this.model,
				max_tokens: this.maxTokens,
				messages: anthropicMessages,
				stream: true,
				...(systemPrompt ? { system: systemPrompt } : {}),
				...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
			};

			const response = this.client.messages.stream(params);

			let fullText = "";
			const toolCalls: ToolCall[] = [];
			const toolCallArgs: Map<string, string> = new Map();
			let promptTokens = 0;
			let completionTokens = 0;

			response.on("text", (text: string) => {
				fullText += text;
				eventStream.push({ type: "text_delta", text });
			});

			response.on("contentBlock", (block: Anthropic.ContentBlock) => {
				if (block.type === "tool_use") {
					const toolCall: ToolCall = {
						id: block.id,
						name: block.name,
						arguments: block.input as Record<string, unknown>,
					};
					toolCalls.push(toolCall);

					eventStream.push({
						type: "tool_call_end",
						toolCallId: block.id,
						arguments: block.input as Record<string, unknown>,
					});
				}
			});

			response.on("inputJson", (partialJson: string, snapshot: unknown) => {
				/* Track partial tool call arguments for streaming events */
				/* Note: contentBlock events handle the completed tool calls */
			});

			response.on("message", (message: Anthropic.Message) => {
				promptTokens = message.usage.input_tokens;
				completionTokens = message.usage.output_tokens;
			});

			const finalMessage = await response.finalMessage();

			promptTokens = finalMessage.usage.input_tokens;
			completionTokens = finalMessage.usage.output_tokens;

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
			/* Handle rate limit errors with exponential backoff */
			if (this.isRateLimitError(err) && retryCount < MAX_RATE_LIMIT_RETRIES) {
				const backoff = RATE_LIMIT_BASE_DELAY_MS * 2 ** retryCount;
				console.warn(
					`[ClaudeProvider] Rate limited — retrying in ${backoff}ms (attempt ${retryCount + 1})`,
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
		const [systemPrompt, anthropicMessages] = toAnthropicMessages(messages);

		try {
			const params: Anthropic.MessageCreateParams = {
				model: this.model,
				max_tokens: this.maxTokens,
				messages: anthropicMessages,
				stream: true,
				...(systemPrompt ? { system: systemPrompt } : {}),
			};

			const response = this.client.messages.stream(params);

			let fullText = "";

			response.on("text", (text: string) => {
				fullText += text;
				eventStream.push(text);
			});

			await response.finalMessage();

			eventStream.complete(fullText);
		} catch (err: unknown) {
			if (this.isRateLimitError(err) && retryCount < MAX_RATE_LIMIT_RETRIES) {
				const backoff = RATE_LIMIT_BASE_DELAY_MS * 2 ** retryCount;
				console.warn(
					`[ClaudeProvider] Rate limited — retrying in ${backoff}ms (attempt ${retryCount + 1})`,
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
