/** The open workspace as the renderer sees it (`workspace:*` channels). */
export interface WorkspaceSummary {
  id: string;
  churchName: string;
  /** Served at `cmp-media://asset/<logoAssetId>`. */
  logoAssetId: string | null;
}

/**
 * - `none`: first launch, no workspace exists yet → onboarding step 1.
 * - `onboarding`: the workspace exists but onboarding was not finished
 *   (the app was closed mid-way) → resume onboarding.
 * - `ready`: normal app shell.
 */
export type WorkspaceState =
  | { status: "none" }
  | { status: "onboarding" | "ready"; workspace: WorkspaceSummary };
