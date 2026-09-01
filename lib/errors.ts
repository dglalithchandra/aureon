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
