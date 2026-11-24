import { join } from "node:path";
import log from "electron-log/main";
import { rotateLogFiles } from "./rotate";

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_FILES = 5;

/** Renderer console warnings/errors, forwarded by the window factory. */
export const rendererLog = log.create({ logId: "renderer" });

/**
 * electron-log writes `logs/main.log` and `logs/renderer.log` with 5 × 5 MB
 * rotation (DOCUMENTATION.md §13). Uncaught errors and Electron process
 * crashes are logged; nothing is shown to the audience.
 */
export function setupLogging(logsDir: string): typeof log {
  for (const [logger, file] of [
    [log, "main.log"],
    [rendererLog, "renderer.log"],
  ] as const) {
    logger.transports.file.resolvePathFn = () => join(logsDir, file);
    logger.transports.file.maxSize = MAX_BYTES;
    logger.transports.file.archiveLogFn = (oldLogFile) =>
      rotateLogFiles(oldLogFile.path, KEEP_FILES);
  }
  rendererLog.transports.console.level = false;

  log.errorHandler.startCatching({ showDialog: false });
  log.eventLogger.startLogging();
  return log;
}

export { log };
