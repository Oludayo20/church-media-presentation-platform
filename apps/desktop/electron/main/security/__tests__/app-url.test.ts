import { describe, expect, it } from "vitest";
import { isAppUrl } from "../app-url";

const rendererDir =
  "/Applications/Church Media.app/Contents/Resources/app.asar/out/renderer";
const rendererUrl =
  "file:///Applications/Church%20Media.app/Contents/Resources/app.asar/out/renderer";

describe("isAppUrl — production (file://)", () => {
  it("accepts pages inside the renderer bundle", () => {
    expect(isAppUrl(`${rendererUrl}/index.html`, undefined, rendererDir)).toBe(
      true,
    );
    expect(
      isAppUrl(`${rendererUrl}/audience.html`, undefined, rendererDir),
    ).toBe(true);
  });

  it("rejects other local files, including sibling-prefix paths", () => {
    expect(isAppUrl("file:///etc/passwd", undefined, rendererDir)).toBe(false);
    expect(
      isAppUrl(`${rendererUrl}-evil/index.html`, undefined, rendererDir),
    ).toBe(false);
  });

  it("rejects remote and malformed URLs", () => {
    expect(isAppUrl("https://example.com", undefined, rendererDir)).toBe(false);
    expect(isAppUrl("not a url", undefined, rendererDir)).toBe(false);
  });
});

describe("isAppUrl — development (Vite dev server)", () => {
  const dev = "http://localhost:5173";

  it("accepts the dev server origin", () => {
    expect(isAppUrl("http://localhost:5173/index.html", dev, rendererDir)).toBe(
      true,
    );
  });

  it("rejects other origins and ports", () => {
    expect(isAppUrl("http://localhost:5174/", dev, rendererDir)).toBe(false);
    expect(isAppUrl("https://localhost:5173/", dev, rendererDir)).toBe(false);
    expect(isAppUrl(`${rendererUrl}/index.html`, dev, rendererDir)).toBe(false);
  });
});
