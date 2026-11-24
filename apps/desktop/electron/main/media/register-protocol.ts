import { protocol } from "electron";
import type { Logger } from "../logging/logger";
import type { WorkspaceManager } from "../workspace/workspace-manager";
import { createMediaProtocolHandler, MEDIA_SCHEME } from "./media-protocol";

/** Must run before `app.whenReady()`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function registerMediaProtocol(
  workspaces: WorkspaceManager,
  logger: Logger,
): void {
  protocol.handle(
    MEDIA_SCHEME,
    createMediaProtocolHandler(
      {
        find: async (kind, assetId) => {
          const workspace = workspaces.current();
          const asset = await workspace?.media.findById(assetId);
          if (!workspace || !asset) return null;
          if (kind === "asset") {
            return {
              root: workspace.mediaDir,
              filePath: asset.filePath,
              mimeType: asset.mimeType,
            };
          }
          if (!asset.thumbnailPath) return null;
          return {
            root: workspace.thumbsDir,
            filePath: asset.thumbnailPath,
            mimeType: asset.thumbnailPath.endsWith(".webp")
              ? "image/webp"
              : "image/jpeg",
          };
        },
      },
      logger,
    ),
  );
}
