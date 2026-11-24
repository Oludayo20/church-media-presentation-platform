import { createElement, FILL } from "./dom";

const BARS = [
  "#c0c0c0",
  "#c0c000",
  "#00c0c0",
  "#00c000",
  "#c000c0",
  "#c00000",
  "#0000c0",
];

/**
 * Projector check (DOCUMENTATION.md §4.1 step 4): a 10% grid, the safe-area
 * box, colour bars, a centre target and a sample lyric, drawn across the
 * whole output so overscan and scaling problems are obvious.
 */
export function createTestPattern(
  doc: Document,
  safeAreaPct: number,
  describe: () => string,
): HTMLElement {
  const root = createElement(
    doc,
    "div",
    { ...FILL, background: "#111" },
    {
      cmpTestPattern: "",
    },
  );

  for (let i = 1; i < 10; i += 1) {
    root.append(
      createElement(doc, "div", {
        position: "absolute",
        top: "0",
        bottom: "0",
        left: `${i * 10}%`,
        width: "1px",
        background: "#3a3a3a",
      }),
      createElement(doc, "div", {
        position: "absolute",
        left: "0",
        right: "0",
        top: `${i * 10}%`,
        height: "1px",
        background: "#3a3a3a",
      }),
    );
  }

  const bars = createElement(doc, "div", {
    position: "absolute",
    left: "20%",
    right: "20%",
    top: "18%",
    height: "14%",
    display: "flex",
  });
  for (const color of BARS) {
    bars.append(createElement(doc, "div", { flex: "1", background: color }));
  }

  const safe = createElement(
    doc,
    "div",
    {
      position: "absolute",
      inset: `${safeAreaPct}%`,
      border: "3px dashed #f5a524",
    },
    { cmpSafeArea: String(safeAreaPct) },
  );

  const edge = createElement(doc, "div", {
    ...FILL,
    boxSizing: "border-box",
    border: "4px solid #e5484d",
  });

  const target = createElement(doc, "div", {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "12vmin",
    height: "12vmin",
    marginLeft: "-6vmin",
    marginTop: "-6vmin",
    border: "3px solid #fff",
    borderRadius: "50%",
  });

  const lyric = createElement(doc, "div", {
    position: "absolute",
    left: "10%",
    right: "10%",
    bottom: "22%",
    textAlign: "center",
    color: "#fff",
    font: "600 5vmin/1.25 Inter, system-ui, sans-serif",
    textShadow: "0 3px 12px #000",
  });
  lyric.textContent = "Sample lyric line one\nSample lyric line two";
  lyric.style.whiteSpace = "pre-line";

  const label = createElement(
    doc,
    "div",
    {
      position: "absolute",
      left: "0",
      right: "0",
      bottom: `${safeAreaPct + 2}%`,
      textAlign: "center",
      color: "#f5a524",
      font: "500 2.4vmin/1.2 ui-monospace, monospace",
    },
    { cmpTestPatternLabel: "" },
  );
  label.textContent = describe();

  root.append(bars, safe, edge, target, lyric, label);
  return root;
}
