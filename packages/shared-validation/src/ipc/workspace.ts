import { z } from "zod";
import type { WorkspaceState, WorkspaceSummary } from "@cmp/shared-types";

export const churchNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your church name")
  .max(120, "Keep the name under 120 characters");

export const workspaceSummarySchema = z.object({
  id: z.string(),
  churchName: z.string(),
  logoAssetId: z.string().nullable(),
}) satisfies z.ZodType<WorkspaceSummary>;

export const workspaceStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none") }),
  z.object({
    status: z.enum(["onboarding", "ready"]),
    workspace: workspaceSummarySchema,
  }),
]) satisfies z.ZodType<WorkspaceState>;

export const createWorkspaceInputSchema = z.object({
  churchName: churchNameSchema,
});

export const renameWorkspaceInputSchema = z.object({
  churchName: churchNameSchema,
});
