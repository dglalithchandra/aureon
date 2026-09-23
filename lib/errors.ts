/**
 * Typed application errors. API routes should `instanceof` check these and
 * return sanitized JSON ({ error: { code, message } }) without ever leaking
 * stack traces to the client.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "LLM_ERROR"
  | "GITHUB_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "BUDGET_EXCEEDED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "STORAGE_UNAVAILABLE"
  | "SIGN_IN_REQUIRED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message, 400);
    this.name = "ValidationError";
  }
}

/**
 * An anonymous browser may keep one scope. The next one needs an account,
 * which also gives it somewhere to live.
 */
export class SignInRequiredError extends AppError {
  constructor(
    message = "Sign in to start another scope. Your current one stays where it is.",
  ) {
    super("SIGN_IN_REQUIRED", message, 401);
    this.name = "SignInRequiredError";
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests") {
    super("RATE_LIMITED", message, 429);
    this.name = "RateLimitError";
  }
}

export class LLMError extends AppError {
  constructor(message: string) {
    super("LLM_ERROR", message, 502);
    this.name = "LLMError";
  }
}

export class GitHubError extends AppError {
  constructor(message: string) {
    super("GITHUB_ERROR", message, 502);
    this.name = "GitHubError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

/** The global daily LLM call budget (LLM_DAILY_CALL_LIMIT) is used up. */
export class BudgetExceededError extends AppError {
  constructor(
    message = "Aureon has reached today's AI usage limit. Please try again tomorrow.",
  ) {
    super("BUDGET_EXCEEDED", message, 503);
    this.name = "BudgetExceededError";
  }
}

/**
 * The scope cannot be generated while the goal (P-01) or the core features
 * (P-03) are missing (BUG-05). `override` bypasses it.
 */
export class BlockedError extends AppError {
  constructor(
    message = "The project goal or core features are still missing, so a scope cannot be generated yet.",
  ) {
    super("BLOCKED", message, 400);
    this.name = "BlockedError";
  }
}

/** A write to Redis failed; nothing was saved (DATA-01). */
export class StorageUnavailableError extends AppError {
  constructor(message = "Storage is unavailable right now. Please try again.") {
    super("STORAGE_UNAVAILABLE", message, 503);
    this.name = "StorageUnavailableError";
  }
}

export interface SerializedError {
  error: { code: ErrorCode; message: string };
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof AppError) {
    return { error: { code: err.code, message: err.message } };
  }
  return {
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  };
}
