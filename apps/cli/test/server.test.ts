import { describe, expect, test } from "bun:test";
import type { StudioTransport } from "@launchd-studio/core/transport";
import { startWebUiServer } from "../src/server/server";

const transport = {
  getCapabilities: async () => ({ launchd: true }),
} as unknown as StudioTransport;

describe("Web UI server boundary", () => {
  test("serves the tokenless API only on the fixed loopback host", async () => {
    const server = startWebUiServer({ transport, port: 0, openBrowser: false });
    try {
      const endpoint = new URL("api/capabilities", server.url);
      const response = await fetch(endpoint);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ launchd: true });

      const foreignOrigin = await fetch(endpoint, {
        headers: { Origin: "http://example.test" },
      });
      expect(foreignOrigin.status).toBe(403);

      const foreignHost = await fetch(endpoint, {
        headers: { Host: "example.test" },
      });
      expect(foreignHost.status).toBe(403);
    } finally {
      server.stop();
    }
  });
});
