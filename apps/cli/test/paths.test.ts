import { describe, expect, test } from "bun:test";
import { defaultManifestPath } from "../src/adapters/paths";

describe("manifest paths", () => {
  test("uses one macOS Application Support manifest", () => {
    expect(defaultManifestPath("/Users/tester")).toBe(
      "/Users/tester/Library/Application Support/launchd-studio/launchd-studio.json",
    );
  });
});
