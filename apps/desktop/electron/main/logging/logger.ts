/** The slice of a logger the testable main-process modules depend on. */
export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
