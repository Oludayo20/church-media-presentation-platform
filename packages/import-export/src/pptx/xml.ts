import { XMLParser } from "fast-xml-parser";

/**
 * fast-xml-parser's `preserveOrder` output: each node is `{ tag: children[] }`
 * plus `":@"` attributes. Order matters for text (runs and line breaks).
 */
export type XNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: false,
});

/** Parses OOXML, refusing DOCTYPE/ENTITY declarations (XXE, entity bombs). */
export function parseXml(text: string): XNode[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("XML with DOCTYPE or ENTITY declarations is not accepted");
  return parser.parse(text) as XNode[];
}

export function tagOf(node: XNode): string | undefined {
  return Object.keys(node).find((key) => key !== ":@");
}

export function kids(node: XNode | undefined): XNode[] {
  if (!node) return [];
  const tag = tagOf(node);
  const value = tag ? node[tag] : undefined;
  return Array.isArray(value) ? (value as XNode[]) : [];
}

export function attr(
  node: XNode | undefined,
  name: string,
): string | undefined {
  const attributes = node?.[":@"] as Record<string, string> | undefined;
  return attributes?.[name];
}

export function child(
  node: XNode | undefined,
  name: string,
): XNode | undefined {
  return kids(node).find((candidate) => tagOf(candidate) === name);
}

export function children(node: XNode | undefined, name: string): XNode[] {
  return kids(node).filter((candidate) => tagOf(candidate) === name);
}

/** `child(child(node, a), b)…` */
export function at(
  node: XNode | undefined,
  ...names: string[]
): XNode | undefined {
  return names.reduce<XNode | undefined>(
    (current, name) => child(current, name),
    node,
  );
}

/** The root element of a parsed document. */
export function root(nodes: XNode[], name: string): XNode | undefined {
  return nodes.find((node) => tagOf(node) === name);
}

/** Concatenated text of a node's direct `#text` children. */
export function textOf(node: XNode | undefined): string {
  return kids(node)
    .map((candidate) =>
      typeof candidate["#text"] === "string"
        ? (candidate["#text"] as string)
        : "",
    )
    .join("");
}

export function num(value: string | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
