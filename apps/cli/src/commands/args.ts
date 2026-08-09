export interface ParsedCliArgs {
  readonly command: string;
  readonly positionals: ReadonlyArray<string>;
  readonly options: Readonly<Record<string, string | boolean>>;
}

const SHORT_OPTIONS: Readonly<Record<string, string>> = {
  c: "config",
  j: "job",
  o: "output",
  h: "help",
  v: "version",
};

const BOOLEAN_OPTIONS = new Set([
  "help",
  "version",
  "json",
  "write",
  "force",
  "start",
  "dry-run",
  "keep-plist",
  "follow",
  "open",
  "allow-remote",
  "check",
  "update",
]);

const VALUE_OPTIONS = new Set([
  "config",
  "job",
  "output",
  "stream",
  "tail",
  "host",
  "port",
]);

export function parseCliArgs(argv: ReadonlyArray<string>): ParsedCliArgs {
  const command = argv[0] ?? "help";
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }
    if (argument === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (argument.startsWith("--no-")) {
      const key = argument.slice(5);
      if (!BOOLEAN_OPTIONS.has(key)) {
        throw new Error(`Unknown boolean option ${argument}.`);
      }
      options[key] = false;
      continue;
    }
    if (argument.startsWith("--")) {
      const [rawKey, inlineValue] = argument.slice(2).split(/=(.*)/su, 2);
      if (rawKey === undefined || rawKey.length === 0) {
        throw new Error(`Invalid option ${argument}.`);
      }
      if (!BOOLEAN_OPTIONS.has(rawKey) && !VALUE_OPTIONS.has(rawKey)) {
        throw new Error(`Unknown option --${rawKey}.`);
      }
      if (inlineValue !== undefined) {
        if (BOOLEAN_OPTIONS.has(rawKey)) {
          throw new Error(`Boolean option --${rawKey} does not accept a value.`);
        }
        if (inlineValue.length === 0) {
          throw new Error(`Option --${rawKey} requires a value.`);
        }
        options[rawKey] = inlineValue;
        continue;
      }
      if (BOOLEAN_OPTIONS.has(rawKey)) {
        options[rawKey] = true;
        continue;
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`Option --${rawKey} requires a value.`);
      }
      options[rawKey] = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-") && argument.length === 2) {
      const shortKey = argument.slice(1);
      const key = SHORT_OPTIONS[shortKey];
      if (key === undefined) {
        throw new Error(`Unknown option ${argument}.`);
      }
      if (BOOLEAN_OPTIONS.has(key)) {
        options[key] = true;
        continue;
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`Option ${argument} requires a value.`);
      }
      options[key] = value;
      index += 1;
      continue;
    }
    positionals.push(argument);
  }

  return { command, positionals, options };
}

export function stringOption(
  options: Readonly<Record<string, string | boolean>>,
  key: string,
): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

export function booleanOption(
  options: Readonly<Record<string, string | boolean>>,
  key: string,
  defaultValue = false,
): boolean {
  const value = options[key];
  return typeof value === "boolean" ? value : defaultValue;
}

export function integerOption(
  options: Readonly<Record<string, string | boolean>>,
  key: string,
  defaultValue: number,
): number {
  const value = stringOption(options, key);
  if (value === undefined) {
    return defaultValue;
  }
  if (!/^-?\d+$/u.test(value)) {
    throw new Error(`Option --${key} must be an integer.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Option --${key} must be a safe integer.`);
  }
  return parsed;
}
