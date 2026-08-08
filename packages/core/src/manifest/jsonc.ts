import type { Diagnostic } from "../domain";

export interface JsoncParseResult {
  readonly value?: unknown;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

interface Position {
  readonly line: number;
  readonly column: number;
}

function positionAt(source: string, offset: number): Position {
  let line = 1;
  let column = 1;
  const boundedOffset = Math.max(0, Math.min(offset, source.length));

  for (let index = 0; index < boundedOffset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

function offsetAt(source: string, line: number, column: number): number {
  let currentLine = 1;
  let offset = 0;

  while (offset < source.length && currentLine < line) {
    if (source[offset] === "\n") {
      currentLine += 1;
    }
    offset += 1;
  }

  return Math.min(source.length, offset + Math.max(0, column - 1));
}

function stripComments(source: string): {
  readonly text: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
} {
  const output = source.split("");
  const diagnostics: Diagnostic[] = [];
  let inString = false;
  let escaped = false;
  let index = 0;

  while (index < source.length) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (current === '"') {
      inString = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "/") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        output[index] = " ";
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      const start = index;
      output[index] = " ";
      output[index + 1] = " ";
      index += 2;
      let closed = false;

      while (index < source.length) {
        const blockCurrent = source[index] ?? "";
        const blockNext = source[index + 1] ?? "";
        if (blockCurrent === "*" && blockNext === "/") {
          output[index] = " ";
          output[index + 1] = " ";
          index += 2;
          closed = true;
          break;
        }
        if (blockCurrent !== "\n" && blockCurrent !== "\r") {
          output[index] = " ";
        }
        index += 1;
      }

      if (!closed) {
        const position = positionAt(source, start);
        diagnostics.push({
          severity: "error",
          code: "jsonc.unterminated-block-comment",
          message: "Block comment is not terminated.",
          path: "$",
          offset: start,
          length: Math.max(1, source.length - start),
          line: position.line,
          column: position.column,
        });
      }
      continue;
    }

    index += 1;
  }

  return { text: output.join(""), diagnostics };
}

function stripTrailingCommas(source: string): string {
  const output = source.split("");
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] ?? "";
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }

    if (current === '"') {
      inString = true;
      continue;
    }

    if (current !== ",") {
      continue;
    }

    let cursor = index + 1;
    while (cursor < source.length && /\s/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }

    const next = source[cursor];
    if (next === "}" || next === "]") {
      output[index] = " ";
    }
  }

  return output.join("");
}

function parseErrorDiagnostic(source: string, error: unknown): Diagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const positionMatch = /position\s+(\d+)/iu.exec(message);
  const lineColumnMatch = /line\s+(\d+)\s+column\s+(\d+)/iu.exec(message);

  let offset = 0;
  if (positionMatch?.[1] !== undefined) {
    offset = Number.parseInt(positionMatch[1], 10);
  } else if (lineColumnMatch?.[1] !== undefined && lineColumnMatch[2] !== undefined) {
    offset = offsetAt(
      source,
      Number.parseInt(lineColumnMatch[1], 10),
      Number.parseInt(lineColumnMatch[2], 10),
    );
  }

  const position = positionAt(source, offset);
  return {
    severity: "error",
    code: "jsonc.syntax",
    message,
    path: "$",
    offset,
    length: 1,
    line: position.line,
    column: position.column,
  };
}

export function parseJsonc(source: string): JsoncParseResult {
  const stripped = stripComments(source);
  if (stripped.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics: stripped.diagnostics };
  }

  const normalized = stripTrailingCommas(stripped.text);
  try {
    const value: unknown = JSON.parse(normalized);
    return { value, diagnostics: stripped.diagnostics };
  } catch (error) {
    return {
      diagnostics: [...stripped.diagnostics, parseErrorDiagnostic(source, error)],
    };
  }
}

type JsoncTokenKind =
  | "open-object"
  | "close-object"
  | "open-array"
  | "close-array"
  | "colon"
  | "comma"
  | "string"
  | "primitive"
  | "line-comment"
  | "block-comment";

interface JsoncToken {
  readonly kind: JsoncTokenKind;
  readonly text: string;
}

function tokenizeJsonc(source: string): ReadonlyArray<JsoncToken> {
  const tokens: JsoncToken[] = [];
  let index = 0;

  while (index < source.length) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (/\s/u.test(current)) {
      index += 1;
      continue;
    }

    const punctuation: Readonly<Record<string, JsoncTokenKind>> = {
      "{": "open-object",
      "}": "close-object",
      "[": "open-array",
      "]": "close-array",
      ":": "colon",
      ",": "comma",
    };
    const punctuationKind = punctuation[current];
    if (punctuationKind !== undefined) {
      tokens.push({ kind: punctuationKind, text: current });
      index += 1;
      continue;
    }

    if (current === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < source.length) {
        const value = source[index] ?? "";
        index += 1;
        if (escaped) {
          escaped = false;
        } else if (value === "\\") {
          escaped = true;
        } else if (value === '"') {
          break;
        }
      }
      tokens.push({ kind: "string", text: source.slice(start, index) });
      continue;
    }

    if (current === "/" && next === "/") {
      const start = index;
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      tokens.push({ kind: "line-comment", text: source.slice(start, index).trimEnd() });
      continue;
    }

    if (current === "/" && next === "*") {
      const start = index;
      index += 2;
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          index += 2;
          break;
        }
        index += 1;
      }
      tokens.push({ kind: "block-comment", text: source.slice(start, index) });
      continue;
    }

    const start = index;
    while (index < source.length) {
      const value = source[index] ?? "";
      const following = source[index + 1] ?? "";
      if (/\s/u.test(value) || "{}[]:,".includes(value)) {
        break;
      }
      if (value === "/" && (following === "/" || following === "*")) {
        break;
      }
      index += 1;
    }
    tokens.push({ kind: "primitive", text: source.slice(start, index) });
  }

  return tokens;
}

function isOpenToken(kind: JsoncTokenKind | undefined): boolean {
  return kind === "open-object" || kind === "open-array";
}

function isCloseToken(kind: JsoncTokenKind | undefined): boolean {
  return kind === "close-object" || kind === "close-array";
}

export function formatJsonc(source: string): {
  readonly formatted?: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
} {
  const parsed = parseJsonc(source);
  if (parsed.value === undefined) {
    return { diagnostics: parsed.diagnostics };
  }

  const tokens = tokenizeJsonc(source);
  const lines: string[] = [];
  let currentLine = "";
  let indentLevel = 0;

  const indentation = (): string => "  ".repeat(indentLevel);
  const hasContent = (): boolean => currentLine.trim().length > 0;
  const ensureIndent = (): void => {
    if (currentLine.length === 0) {
      currentLine = indentation();
    }
  };
  const append = (value: string): void => {
    ensureIndent();
    currentLine += value;
  };
  const newline = (): void => {
    if (hasContent()) {
      lines.push(currentLine.trimEnd());
    }
    currentLine = "";
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    const previous = tokens[index - 1];
    const next = tokens[index + 1];

    switch (token.kind) {
      case "open-object":
      case "open-array": {
        append(token.text);
        if (!isCloseToken(next?.kind)) {
          indentLevel += 1;
          newline();
        }
        break;
      }
      case "close-object":
      case "close-array": {
        if (isOpenToken(previous?.kind)) {
          append(token.text);
          break;
        }
        indentLevel = Math.max(0, indentLevel - 1);
        if (hasContent()) {
          newline();
        }
        append(token.text);
        break;
      }
      case "colon": {
        append(": ");
        break;
      }
      case "comma": {
        append(",");
        if (next?.kind !== "line-comment") {
          newline();
        }
        break;
      }
      case "line-comment": {
        if (hasContent()) {
          currentLine += " ";
        }
        append(token.text);
        newline();
        break;
      }
      case "block-comment": {
        const standalone =
          previous === undefined ||
          previous.kind === "open-object" ||
          previous.kind === "open-array" ||
          previous.kind === "comma" ||
          previous.kind === "line-comment";
        if (hasContent()) {
          currentLine += " ";
        }
        const commentLines = token.text.split(/\r?\n/u);
        for (let lineIndex = 0; lineIndex < commentLines.length; lineIndex += 1) {
          const commentLine = commentLines[lineIndex] ?? "";
          append(lineIndex === 0 ? commentLine.trimStart() : commentLine.trim());
          if (lineIndex < commentLines.length - 1) {
            newline();
          }
        }
        if (standalone && next?.kind !== "comma" && !isCloseToken(next?.kind)) {
          newline();
        } else if (next !== undefined && next.kind !== "comma" && !isCloseToken(next.kind)) {
          currentLine += " ";
        }
        break;
      }
      case "string":
      case "primitive": {
        append(token.text);
        break;
      }
    }
  }

  if (hasContent()) {
    lines.push(currentLine.trimEnd());
  }

  const formatted = `${lines.join("\n")}\n`;
  const validation = parseJsonc(formatted);
  if (validation.value === undefined) {
    return {
      diagnostics: [
        ...parsed.diagnostics,
        {
          severity: "error",
          code: "jsonc.format-internal",
          message: "The formatter produced invalid JSONC.",
          path: "$",
        },
      ],
    };
  }

  return { formatted, diagnostics: parsed.diagnostics };
}
