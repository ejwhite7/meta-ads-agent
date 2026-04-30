/**
 * @module llm/registry
 * LLM provider registry with lazy instantiation.
 *
 * Providers are registered as factory functions and only instantiated
 * when first requested. This avoids importing unused SDKs and paying
 * their initialization cost when the user has configured a different provider.
 */

import type { LLMProvider, LLMProviderFactory } from "./types.js";

/**
 * Registry that manages LLM provider factories and instances.
 *
 * Providers are registered by name with a factory function. The factory
 * is called only once — on the first get() call for that provider.
 * Subsequent calls return the cached instance.
 *
 * @example
 * ```ts
 * const registry = new LLMRegistry();
 * registry.register('claude', () => new ClaudeProvider({ apiKey: '...' }));
 * registry.register('openai', () => new OpenAIProvider({ apiKey: '...' }));
 *
 * // Provider is instantiated lazily on first access
 * const provider = registry.get('claude');
 * ```
 */
export class LLMRegistry {
	/** Factory functions keyed by provider name */
	private readonly factories: Map<string, LLMProviderFactory> = new Map();

	/** Cached provider instances (populated on first get) */
	private readonly instances: Map<string, LLMProvider> = new Map();

	/**
	 * Registers a provider factory under the given name.
	 *
	 * @param name - Provider name (e.g., "claude", "openai")
	 * @param factory - Factory function that creates the provider instance
	 * @throws {Error} If a provider with the same name is already registered
	 */
	register(name: string, factory: LLMProviderFactory): void {
		if (this.factories.has(name)) {
			throw new Error(`LLM provider "${name}" is already registered.`);
		}
		this.factories.set(name, factory);
	}

	/**
	 * Retrieves a provider by name, instantiating it lazily if needed.
	 *
	 * The factory function is called only on the first get() for each name.
	 * The resulting instance is cached for all subsequent calls.
	 *
	 * @param name - Provider name to look up
	 * @returns The LLM provider instance
	 * @throws {Error} If no provider is registered under the given name
	 */
	get(name: string): LLMProvider {
		const cached = this.instances.get(name);
		if (cached) {
			return cached;
		}

		const factory = this.factories.get(name);
		if (!factory) {
			throw new Error(
				`LLM provider "${name}" is not registered. Available: ${this.getAvailableNames().join(", ") || "none"}`,
			);
		}

		const instance = factory();
		this.instances.set(name, instance);
		return instance;
	}

	/**
	 * Checks whether a provider with the given name is registered.
	 *
	 * @param name - Provider name to check
	 * @returns True if a factory exists for this name
	 */
	has(name: string): boolean {
		return this.factories.has(name);
	}

	/**
	 * Returns the names of all registered providers.
	 *
	 * @returns Array of registered provider names
	 */
	getAvailableNames(): string[] {
		return Array.from(this.factories.keys());
	}

	/**
	 * Removes all registered factories and cached instances.
	 * Primarily used in tests.
	 */
	clear(): void {
		this.factories.clear();
		this.instances.clear();
	}
}
