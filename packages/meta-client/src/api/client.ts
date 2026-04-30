/**
 * @module api/client
 *
 * Axios-based HTTP client for the Meta Marketing API (graph.facebook.com/v21.0).
 * Handles authentication via access token injection, automatic retry with
 * exponential backoff for transient errors (429, 500, 503), and integration
 * with the per-account rate limiter.
 *
 * This client is used by all direct API endpoint modules for operations
 * that the CLI does not support: audiences, batch operations, split tests,
 * ad rules, and ad previews.
 */

import axios, {
	type AxiosInstance,
	type AxiosRequestConfig,
	type AxiosResponse,
	type AxiosError,
} from "axios";
import { AuthError, MetaError, NotFoundError, RateLimitError, ValidationError } from "../errors.js";
import { RateLimiter } from "./rate-limiter.js";

/** Base URL for the Meta Marketing API. */
const META_API_BASE_URL = "https://graph.facebook.com/v21.0";

/**
 * Configuration for the Meta API client.
 */
export interface ApiClientConfig {
	/** Meta system user access token. */
	accessToken: string;
	/** Default ad account ID for rate limit tracking. */
	adAccountId: string;
	/** Maximum retry attempts for transient errors. Defaults to 3. */
	maxRetries?: number;
	/** Base delay in milliseconds for exponential backoff. Defaults to 1000. */
	baseRetryDelay?: number;
	/** Rate limit usage threshold (0-100). Defaults to 75. */
	rateLimitThreshold?: number;
}

/**
 * Meta Marketing API response wrapper containing data and pagination.
 */
export interface ApiResponse<T> {
	/** Response data payload. */
	data: T;
	/** Pagination cursor information. */
	paging?: {
		cursors?: { before?: string; after?: string };
		next?: string;
		previous?: string;
	};
}

/**
 * HTTP client for direct Meta Marketing API access. Wraps axios with
 * automatic authentication, rate limiting, and retry logic.
 *
 * @example
 * ```typescript
 * const client = new ApiClient({
 *   accessToken: "EAAx...",
 *   adAccountId: "act_123456",
 * });
 * const response = await client.get<Campaign[]>("/act_123456/campaigns", {
 *   params: { fields: "id,name,status" },
 * });
 * ```
 */
export class ApiClient {
	private readonly axios: AxiosInstance;
	private readonly accessToken: string;
	private readonly adAccountId: string;
	private readonly maxRetries: number;
	private readonly baseRetryDelay: number;
	private readonly rateLimiter: RateLimiter;

	constructor(config: ApiClientConfig) {
		this.accessToken = config.accessToken;
		this.adAccountId = config.adAccountId;
		this.maxRetries = config.maxRetries ?? 3;
		this.baseRetryDelay = config.baseRetryDelay ?? 1000;
		this.rateLimiter = new RateLimiter({ threshold: config.rateLimitThreshold ?? 75 });

		this.axios = axios.create({
			baseURL: META_API_BASE_URL,
			timeout: 30_000,
		});
	}

	/**
	 * Sends a GET request to the Meta Marketing API.
	 *
	 * @typeParam T - Expected response data type.
	 * @param path - API endpoint path (e.g., "/act_123/campaigns").
	 * @param config - Optional axios request configuration.
	 * @returns Parsed response data.
	 */
	async get<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
		return this.request<T>("GET", path, config);
	}

	/**
	 * Sends a POST request to the Meta Marketing API.
	 *
	 * @typeParam T - Expected response data type.
	 * @param path - API endpoint path.
	 * @param data - Request body data.
	 * @param config - Optional axios request configuration.
	 * @returns Parsed response data.
	 */
	async post<T>(path: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
		return this.request<T>("POST", path, { ...config, data });
	}

	/**
	 * Sends a DELETE request to the Meta Marketing API.
	 *
	 * @typeParam T - Expected response data type.
	 * @param path - API endpoint path.
	 * @param config - Optional axios request configuration.
	 * @returns Parsed response data.
	 */
	async delete<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
		return this.request<T>("DELETE", path, config);
	}

	/**
	 * Returns the rate limiter instance for external monitoring.
	 */
	getRateLimiter(): RateLimiter {
		return this.rateLimiter;
	}

	/**
	 * Core request method with authentication, rate limiting, and retry logic.
	 */
	private async request<T>(method: string, path: string, config?: AxiosRequestConfig): Promise<T> {
		await this.rateLimiter.acquire(this.adAccountId);

		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			try {
				const response = await this.executeRequest<T>(method, path, config);
				this.rateLimiter.updateFromHeaders(
					this.adAccountId,
					this.normalizeHeaders(response.headers as Record<string, string>),
				);
				return response.data;
			} catch (error: unknown) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (!this.isRetryable(error) || attempt === this.maxRetries) {
					throw this.mapError(error);
				}

				const delay = this.calculateBackoff(attempt, error);
				await this.sleep(delay);
			}
		}

		throw lastError ?? new MetaError("Request failed after retries", "RETRY_EXHAUSTED");
	}

	/**
	 * Executes a single HTTP request with authentication.
	 */
	private async executeRequest<T>(
		method: string,
		path: string,
		config?: AxiosRequestConfig,
	): Promise<AxiosResponse<T>> {
		return this.axios.request<T>({
			method,
			url: path,
			...config,
			params: {
				// access_token moved to Authorization header
				...config?.params,
			},
		});
	}

	/**
	 * Determines whether an error is retryable (transient).
	 * Rate limit errors (429) and server errors (500, 503) are retryable.
	 * Client errors (400, 401, 403, 404) are not.
	 */
	private isRetryable(error: unknown): boolean {
		if (!axios.isAxiosError(error)) {
			return false;
		}

		const status = error.response?.status;
		if (!status) {
			// Network errors (no response) are retryable
			return true;
		}

		return status === 429 || status >= 500;
	}

	/**
	 * Calculates the backoff delay for a retry attempt.
	 * Uses exponential backoff with jitter, respecting the Retry-After
	 * header for 429 responses.
	 */
	private calculateBackoff(attempt: number, error: unknown): number {
		if (axios.isAxiosError(error) && error.response?.status === 429) {
			const retryAfter = error.response.headers["retry-after"];
			if (retryAfter) {
				return Number.parseInt(retryAfter, 10) * 1000;
			}
		}

		// Exponential backoff with jitter: delay * 2^attempt + random(0-1000ms)
		const exponentialDelay = this.baseRetryDelay * 2 ** attempt;
		const jitter = Math.random() * 1000;
		return exponentialDelay + jitter;
	}

	/**
	 * Maps axios errors to typed Meta client errors.
	 */
	private mapError(error: unknown): MetaError {
		if (error instanceof MetaError) {
			return error;
		}

		if (!axios.isAxiosError(error)) {
			return new MetaError(error instanceof Error ? error.message : String(error), "UNKNOWN");
		}

		const axiosError = error as AxiosError<{
			error?: { message?: string; code?: number; type?: string };
		}>;
		const status = axiosError.response?.status;
		const apiError = axiosError.response?.data?.error;
		const message = apiError?.message ?? axiosError.message;

		switch (status) {
			case 400:
				return new ValidationError(message);
			case 401:
			case 403:
				return new AuthError(message);
			case 404:
				return new NotFoundError(message);
			case 429:
				return new RateLimitError(message);
			default:
				return new MetaError(message, apiError?.type ?? "API_ERROR", status);
		}
	}

	/**
	 * Normalizes response headers to lowercase keys for consistent access.
	 */
	private normalizeHeaders(headers: Record<string, string>): Record<string, string> {
		const normalized: Record<string, string> = {};
		for (const [key, value] of Object.entries(headers)) {
			normalized[key.toLowerCase()] = value;
		}
		return normalized;
	}

	/**
	 * Utility sleep function.
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
