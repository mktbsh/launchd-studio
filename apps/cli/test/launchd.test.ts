import { describe, expect, test } from "bun:test";
import { parseLaunchctlPrint } from "../src/adapters/launchd";

describe("launchctl output parser", () => {
  test("extracts runtime state", () => {
    const result = parseLaunchctlPrint(`gui/501/dev.example.api = {
      active count = 1
      state = running
      runs = 4
      pid = 1234
      last exit code = 0
    }`);
    expect(result).toEqual({
      supported: true,
      loaded: true,
      running: true,
      state: "running",
      pid: 1234,
      runs: 4,
      lastExitCode: 0,
    });
  });
});
