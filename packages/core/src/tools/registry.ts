/**
 * @module tools/registry
 * Map-based tool registry for the meta-ads-agent.
 *
 * Stores tool definitions keyed by their unique name. Validates that no
 * duplicate names are registered and provides lookup methods used by the
 * agent loop, decision engine, and LLM adapter layer.
 */

import type { TObject } from "@sinclair/typebox";
import type { Tool } from "./types.js";

/**
 * Registry that manages all available tools for the agent.
 *
 * Tools are stored in a Map keyed by name, ensuring O(1) lookup.
 * Registration validates uniqueness — attempting to register a tool
 * with a duplicate name throws an error to catch configuration bugs early.
 *
 * @example
 * ```ts
 * const registry = new ToolRegistry();
 * registry.register(updateBudgetTool);
 * registry.register(pauseCampaignTool);
 *
 * const tool = registry.get('update_budget');
 * const allTools = registry.getAll();
 * ```
 */
export class ToolRegistry {
	/** Internal storage for registered tools, keyed by tool name */
	private readonly tools: Map<string, Tool<TObject>> = new Map();

	/**
	 * Registers a tool in the registry.
	 *
	 * @param tool - Tool definition to register
	 * @throws {Error} If a tool with the same name is already registered
	 */
	register(tool: Tool<TObject>): void {
		if (this.tools.has(tool.name)) {
			throw new Error(
				`Tool "${tool.name}" is already registered. Each tool must have a unique name.`,
			);
		}
		this.tools.set(tool.name, tool);
	}

	/**
	 * Retrieves a tool by name.
	 *
	 * @param name - The unique name of the tool to look up
	 * @returns The tool definition, or undefined if not found
	 */
	get(name: string): Tool<TObject> | undefined {
		return this.tools.get(name);
	}

	/**
	 * Returns all registered tools as an array.
	 * Useful for passing the full tool set to the LLM provider.
	 *
	 * @returns Array of all registered tool definitions
	 */
	getAll(): Tool<TObject>[] {
		return Array.from(this.tools.values());
	}

	/**
	 * Checks whether a tool with the given name is registered.
	 *
	 * @param name - Tool name to check
	 * @returns True if the tool exists in the registry
	 */
	has(name: string): boolean {
		return this.tools.has(name);
	}

	/**
	 * Returns the number of tools currently registered.
	 *
	 * @returns Count of registered tools
	 */
	get size(): number {
		return this.tools.size;
	}

	/**
	 * Removes all registered tools. Primarily used in tests.
	 */
	clear(): void {
		this.tools.clear();
	}
}
