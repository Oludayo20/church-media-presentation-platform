import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fail, ok } from "@cmp/shared-types";
import { appInfoSchema, ipcChannels, ipcResultSchema } from "../index";

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
  it("app:info takes no input", () => {
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
});
