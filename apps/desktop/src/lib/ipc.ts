import type { ErrorCode, IpcResult } from "@cmp/shared-types";

/** A failed IPC call, carrying the envelope's error code. */
export class IpcClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "IpcClientError";
  }
}

/** Unwraps the §2.3 envelope: returns `data` or throws `IpcClientError`. */
export async function unwrap<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call;
  if (result.success) return result.data;
  throw new IpcClientError(
    result.error.code,
    result.error.message,
    result.error.details,
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof IpcClientError) {
    if (error.code === "VALIDATION_ERROR" && Array.isArray(error.details)) {
      const first = error.details[0] as { message?: string } | undefined;
      if (first?.message) return first.message;
    }
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
