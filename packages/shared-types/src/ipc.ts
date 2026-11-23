/**
 * The envelope every IPC handler returns.
 * See docs/DOCUMENTATION.md §2.3 "Response envelope".
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "MEDIA_MISSING",
  "DISPLAY_UNAVAILABLE",
  "LIVE_SESSION_ACTIVE",
  "IO_ERROR",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface IpcError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type IpcResult<T> =
  { success: true; data: T } | { success: false; error: IpcError };

export function ok<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

export function fail(
  code: ErrorCode,
  message: string,
  details?: unknown,
): IpcResult<never> {
  const error: IpcError =
    details === undefined ? { code, message } : { code, message, details };
  return { success: false, error };
}
