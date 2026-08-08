import { isValidXmlText } from "../text";

export type PlistValue =
  | string
  | number
  | boolean
  | ReadonlyArray<PlistValue>
  | PlistDictionary;

export interface PlistDictionary {
  readonly kind: "dictionary";
  readonly entries: ReadonlyArray<readonly [string, PlistValue]>;
}

export function plistDictionary(
  entries: ReadonlyArray<readonly [string, PlistValue]>,
): PlistDictionary {
  return { kind: "dictionary", entries };
}


function isPlistDictionary(value: PlistValue): value is PlistDictionary {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as PlistDictionary).kind === "dictionary"
  );
}

function escapeXml(value: string): string {
  if (!isValidXmlText(value)) {
    throw new Error("plist strings must contain only valid XML 1.0 text characters");
  }
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function indent(level: number): string {
  return "  ".repeat(level);
}

function renderDictionary(value: PlistDictionary, level: number): string {
  if (value.entries.length === 0) {
    return `${indent(level)}<dict/>`;
  }

  const lines = [`${indent(level)}<dict>`];
  for (const [key, entry] of value.entries) {
    lines.push(`${indent(level + 1)}<key>${escapeXml(key)}</key>`);
    lines.push(renderPlistValue(entry, level + 1));
  }
  lines.push(`${indent(level)}</dict>`);
  return lines.join("\n");
}

export function renderPlistValue(value: PlistValue, level: number): string {
  if (typeof value === "string") {
    return `${indent(level)}<string>${escapeXml(value)}</string>`;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`plist integer expected, received ${value}`);
    }
    return `${indent(level)}<integer>${value}</integer>`;
  }
  if (typeof value === "boolean") {
    return `${indent(level)}<${value ? "true" : "false"}/>`;
  }
  if (isPlistDictionary(value)) {
    return renderDictionary(value, level);
  }
  if (value.length === 0) {
    return `${indent(level)}<array/>`;
  }
  const lines = [`${indent(level)}<array>`];
  for (const entry of value) {
    lines.push(renderPlistValue(entry, level + 1));
  }
  lines.push(`${indent(level)}</array>`);
  return lines.join("\n");
}

export function renderPlist(dictionary: PlistDictionary): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    renderDictionary(dictionary, 1),
    "</plist>",
    "",
  ].join("\n");
}
