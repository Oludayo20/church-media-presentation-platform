import { describe, expect, it } from "vitest";
import { buttonVariants, cn } from "../index";

describe("cn", () => {
  it("lets the later Tailwind utility win a conflict", () => {
    expect(cn("px-2 text-sm", "px-4")).toBe("text-sm px-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });
});

describe("buttonVariants", () => {
  it("defaults to the primary, medium button", () => {
    const classes = buttonVariants();
    expect(classes).toContain("bg-primary");
    expect(classes).toContain("h-9");
  });

  it("has a live variant for go-live controls", () => {
    expect(buttonVariants({ variant: "live" })).toContain("bg-live");
  });
});
