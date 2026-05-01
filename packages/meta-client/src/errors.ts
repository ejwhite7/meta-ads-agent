/**
 * @module errors
 *
 * Typed error hierarchy for the Meta client package. Provides specific error
 * classes for each failure mode of the Marketing API: rate limiting,
 * authentication, not-found resources, and validation. All errors extend
 * the base MetaError class for unified catch handling.
 */

/**
 * Base error class for all Meta client errors.
 * Carries an error code and optional HTTP status for programmatic handling.
 */
export class MetaError extends Error {
	/** Machine-readable error code (e.g., "RATE_LIMIT", "AUTH_FAILED"). */
	public readonly code: string;

	/** HTTP status code from the Meta API, if applicable. */
	public readonly httpStatus?: number;

	constructor(message: string, code: string, httpStatus?: number) {
		super(message);
		this.name = "MetaError";
		this.code = code;
		this.httpStatus = httpStatus;
	}
}

/**
 * Thrown when the Meta Marketing API rate limit is exceeded.
 * The caller should wait before retrying. The `retryAfter` property
 * indicates the recommended delay in seconds, if available from the
 * API response headers.
 */
export class RateLimitError extends MetaError {
	/** Recommended delay in seconds before retrying. */
	public readonly retryAfter?: number;

	constructor(message: string, retryAfter?: number) {
		super(message, "RATE_LIMIT", 429);
		this.name = "RateLimitError";
		this.retryAfter = retryAfter;
	}
}

/**
 * Thrown when authentication fails — either an invalid/expired access token
 * or a missing required permission scope. Maps to CLI exit code 3 or
 * HTTP 401/403 from the Marketing API.
 */
export class AuthError extends MetaError {
	constructor(message: string) {
		super(message, "AUTH_FAILED", 401);
		this.name = "AuthError";
	}
}

/**
 * Thrown when a requested resource (campaign, ad set, ad, audience, etc.)
 * does not exist. Maps to CLI exit code 5 or HTTP 404 from the Marketing API.
 */
export class NotFoundError extends MetaError {
	constructor(message: string) {
		super(message, "NOT_FOUND", 404);
		this.name = "NotFoundError";
	}
}

/**
 * Thrown when a Meta API request fails with a validation error (HTTP 400).
 * Typically caused by invalid parameters or constraint violations.
 */
export class ValidationError extends MetaError {
	constructor(message: string) {
		super(message, "VALIDATION_ERROR", 400);
		this.name = "ValidationError";
	}
}
