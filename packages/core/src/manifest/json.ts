import type { Diagnostic } from "../domain";

export interface ManifestJsonParseResult {
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

// Engines disagree on the shape of a JSON.parse message: V8 reports a byte
// position, JavaScriptCore reports line and column.
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
    code: "json.syntax",
    message,
    path: "$",
    offset,
    length: 1,
    line: position.line,
    column: position.column,
  };
}

export function parseManifestJson(source: string): ManifestJsonParseResult {
  try {
    const value: unknown = JSON.parse(source);
    return { value, diagnostics: [] };
  } catch (error) {
    return { diagnostics: [parseErrorDiagnostic(source, error)] };
  }
}

export function formatManifestJson(source: string): {
  readonly formatted?: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
} {
  const parsed = parseManifestJson(source);
  if (parsed.value === undefined) {
    return { diagnostics: parsed.diagnostics };
  }

  return { formatted: stringifyManifest(parsed.value), diagnostics: [] };
}

export function stringifyManifest(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
