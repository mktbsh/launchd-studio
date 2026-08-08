import { describe, expect, test } from "bun:test";
import { pathHasDirectory, withPathDirectory } from "../src/app/job";

const SHIMS = "/Users/tester/.local/share/mise/shims";
const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

describe("PATH entries", () => {
  test("prepends the directory to the launchd default PATH", () => {
    const entries = withPathDirectory([], SHIMS, true);
    expect(entries).toEqual([["PATH", `${SHIMS}:${LAUNCHD_PATH}`]]);
    expect(pathHasDirectory(entries, SHIMS)).toBe(true);
  });

  test("keeps other variables and the existing PATH position", () => {
    const entries = withPathDirectory(
      [["PATH", "/opt/bin"], ["NODE_ENV", "development"]],
      SHIMS,
      true,
    );
    expect(entries).toEqual([["PATH", `${SHIMS}:/opt/bin`], ["NODE_ENV", "development"]]);
  });

  test("does not add the directory twice", () => {
    const once = withPathDirectory([], SHIMS, true);
    expect(withPathDirectory(once, SHIMS, true)).toEqual(once);
  });

  test("drops PATH when removing leaves only the launchd default", () => {
    const entries = withPathDirectory([["NODE_ENV", "development"]], SHIMS, true);
    expect(withPathDirectory(entries, SHIMS, false)).toEqual([["NODE_ENV", "development"]]);
    expect(pathHasDirectory([], SHIMS)).toBe(false);
  });

  test("keeps a custom PATH after removing the directory", () => {
    const entries: ReadonlyArray<readonly [string, string]> = [["PATH", `${SHIMS}:/opt/bin`]];
    expect(withPathDirectory(entries, SHIMS, false)).toEqual([["PATH", "/opt/bin"]]);
  });
});
