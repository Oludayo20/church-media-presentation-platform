import type { ErrorCode } from "./ipc";

/**
 * An expected, user-facing failure. Thrown by repositories and IPC handlers;
 * the main-process IPC router turns it into `fail(code, message, details)`.
 * Anything that is not an AppError becomes a generic `INTERNAL` error so
 * stack traces and file paths never reach the renderer.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
