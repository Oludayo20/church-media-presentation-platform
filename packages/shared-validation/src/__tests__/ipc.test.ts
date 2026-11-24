import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fail, ok } from "@cmp/shared-types";
import {
  appInfoSchema,
  IPC_CHANNEL_NAMES,
  ipcChannels,
  ipcResultSchema,
  workspaceStateSchema,
} from "../index";

describe("ipcResultSchema", () => {
  const schema = ipcResultSchema(z.object({ id: z.string() }));

  it("accepts envelopes built by the shared-types helpers", () => {
    expect(schema.safeParse(ok({ id: "p1" })).success).toBe(true);
    expect(schema.safeParse(fail("CONFLICT", "in use")).success).toBe(true);
  });

  it("rejects unknown error codes and malformed data", () => {
    expect(
      schema.safeParse({
        success: false,
        error: { code: "TEAPOT", message: "x" },
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ success: true, data: { id: 1 } }).success).toBe(
      false,
    );
  });
});

describe("ipcChannels", () => {
  it("lists exactly the channels the preload exposes", () => {
    expect(Object.keys(ipcChannels).sort()).toEqual(
      [...IPC_CHANNEL_NAMES].sort(),
    );
  });

  it("names every channel <namespace>:<method>", () => {
    for (const channel of IPC_CHANNEL_NAMES) {
      expect(channel).toMatch(/^[a-z]+:[a-zA-Z]+$/);
    }
  });

  it("no-input channels reject a payload", () => {
    expect(ipcChannels["app:info"].input.safeParse(undefined).success).toBe(
      true,
    );
    expect(ipcChannels["app:info"].input.safeParse({ x: 1 }).success).toBe(
      false,
    );
  });

  it("app:info output matches AppInfo", () => {
    const info = {
      name: "Church Media",
      version: "0.0.0",
      platform: "darwin",
      electron: "45.0.0",
      chrome: "140.0.0",
    };
    expect(appInfoSchema.parse(info)).toEqual(info);
  });

  it("workspace:create trims and requires a church name", () => {
    const input = ipcChannels["workspace:create"].input;
    expect(input.parse({ churchName: "  Grace Chapel " })).toEqual({
      churchName: "Grace Chapel",
    });
    expect(input.safeParse({ churchName: "   " }).success).toBe(false);
    expect(input.safeParse({ churchName: "x".repeat(121) }).success).toBe(
      false,
    );
  });

  it("workspace state is a discriminated union", () => {
    expect(workspaceStateSchema.parse({ status: "none" })).toEqual({
      status: "none",
    });
    expect(workspaceStateSchema.safeParse({ status: "ready" }).success).toBe(
      false,
    );
  });
});
