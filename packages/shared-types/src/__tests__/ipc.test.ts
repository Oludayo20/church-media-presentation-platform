import { describe, expect, it } from "vitest";
import { fail, ok } from "../ipc";

describe("IPC envelope helpers", () => {
  it("wraps data in a success envelope", () => {
    expect(ok({ id: "p1" })).toEqual({ success: true, data: { id: "p1" } });
  });

  it("omits details when none are given", () => {
    expect(fail("NOT_FOUND", "missing")).toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "missing" },
    });
  });

  it("keeps details when given", () => {
    const result = fail("VALIDATION_ERROR", "bad input", [{ path: "title" }]);
    expect(result).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "bad input",
        details: [{ path: "title" }],
      },
    });
  });
});
