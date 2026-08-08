import { describe, expect, test } from "bun:test";
import {
  booleanOption,
  integerOption,
  parseCliArgs,
  stringOption,
} from "../src/commands/args";

describe("CLI arguments", () => {
  test("parses positional IDs and common options", () => {
    const parsed = parseCliArgs([
      "render",
      "local-api",
      "--config",
      "./launchd.json",
      "--json",
    ]);
    expect(parsed.command).toBe("render");
    expect(parsed.positionals).toEqual(["local-api"]);
    expect(stringOption(parsed.options, "config")).toBe("./launchd.json");
    expect(booleanOption(parsed.options, "json")).toBe(true);
  });

  test("supports negative boolean options", () => {
    const parsed = parseCliArgs(["web-ui", "--no-open"]);
    expect(booleanOption(parsed.options, "open", true)).toBe(false);
  });

  test("requires integers to be entirely numeric", () => {
    expect(() => integerOption({ port: "12x" }, "port", 0)).toThrow();
  });

  test("rejects unknown and malformed options", () => {
    expect(() => parseCliArgs(["plan", "--dryrun"])).toThrow();
    expect(() => parseCliArgs(["web-ui", "--no-host"])).toThrow();
    expect(() => parseCliArgs(["validate", "--json=false"])).toThrow();
  });
});
