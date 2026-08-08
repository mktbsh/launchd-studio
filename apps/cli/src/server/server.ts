import { stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
  ControlAction,
  LogStream,
  StudioTransport,
} from "@launchd-studio/core/transport";
import { StudioError } from "../service";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface WebUiServerOptions {
  readonly transport: StudioTransport;
  readonly host: string;
  readonly port: number;
  readonly openBrowser: boolean;
  readonly allowRemote: boolean;
}

export interface RunningWebUiServer {
  readonly url: string;
  readonly publicUrl: string;
  readonly host: string;
  readonly port: number;
  stop(): void;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function createToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof StudioError) {
    return jsonResponse(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      error.status,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse(
    {
      error: {
        code: "internal.error",
        message,
      },
    },
    500,
  );
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number.parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    throw new StudioError("Request body is too large.", {
      status: 413,
      code: "request.too-large",
    });
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    throw new StudioError("Request body is too large.", {
      status: 413,
      code: "request.too-large",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StudioError("Request body must be valid JSON.", {
      status: 400,
      code: "request.invalid-json",
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new StudioError("Request body must be a JSON object.", {
      status: 400,
      code: "request.invalid-body",
    });
  }
  return parsed as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") {
    throw new StudioError(`${key} must be a string.`, {
      status: 400,
      code: "request.invalid-field",
    });
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new StudioError(`${key} must be a string.`, {
      status: 400,
      code: "request.invalid-field",
    });
  }
  return value;
}

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new StudioError(`${key} must be a boolean.`, {
      status: 400,
      code: "request.invalid-field",
    });
  }
  return value;
}

function optionalInteger(
  body: Record<string, unknown>,
  key: string,
  defaultValue: number,
): number {
  const value = body[key];
  if (value === undefined) {
    return defaultValue;
  }
  if (!Number.isInteger(value)) {
    throw new StudioError(`${key} must be an integer.`, {
      status: 400,
      code: "request.invalid-field",
    });
  }
  return value as number;
}

interface StaticAssets {
  readonly root: string | null;
  readonly embedded: ReadonlyMap<string, Blob>;
}

function findStaticRoot(): string | null {
  const candidates = [
    process.env.LAUNCHD_STUDIO_WEB_DIST,
    resolve(import.meta.dir, "../../../web/dist"),
    resolve(process.cwd(), "apps/web/dist"),
  ].filter((candidate): candidate is string => candidate !== undefined);

  for (const candidate of candidates) {
    try {
      if (Bun.file(resolve(candidate, "index.html")).size > 0) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function embeddedAssetRelativePath(file: Blob): string | null {
  const namedFile = file as Blob & { readonly name?: unknown };
  if (typeof namedFile.name !== "string") {
    return null;
  }
  const marker = "web/dist/";
  const markerIndex = namedFile.name.lastIndexOf(marker);
  return markerIndex < 0 ? null : namedFile.name.slice(markerIndex + marker.length);
}

function findEmbeddedStaticAssets(): ReadonlyMap<string, Blob> {
  const assets = new Map<string, Blob>();
  for (const file of Bun.embeddedFiles) {
    const relativePath = embeddedAssetRelativePath(file);
    if (relativePath !== null) {
      assets.set(relativePath, file);
    }
  }
  return assets;
}

function findStaticAssets(): StaticAssets {
  const embedded = findEmbeddedStaticAssets();
  return {
    root: findStaticRoot(),
    embedded,
  };
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function staticHeaders(path: string): Headers {
  const headers = new Headers({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  });
  headers.set(
    "Cache-Control",
    path.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
  );
  return headers;
}

async function serveStatic(request: Request, assets: StaticAssets): Promise<Response> {
  if (assets.root === null && !assets.embedded.has("index.html")) {
    return new Response(
      "Web UI assets are missing. Run `bun run build:web` before `launchd-studio web-ui`.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(request.url);
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (requested.includes("\0") || requested.split(/[\\/]+/u).includes("..")) {
    return new Response("Bad Request", { status: 400 });
  }

  if (assets.root === null) {
    const relativePath = assets.embedded.has(requested) ? requested : "index.html";
    const file = assets.embedded.get(relativePath);
    if (file === undefined) {
      return new Response("Not Found", { status: 404 });
    }
    const headers = staticHeaders(relativePath);
    if (file.type.length > 0) {
      headers.set("Content-Type", file.type);
    }
    return new Response(request.method === "HEAD" ? null : file, { headers });
  }

  const candidate = resolve(assets.root, requested);
  const relativePath = relative(assets.root, candidate);
  if (
    relativePath.startsWith(`..${sep}`) ||
    relativePath === ".." ||
    relativePath.includes("\0")
  ) {
    return new Response("Bad Request", { status: 400 });
  }

  const path = (await isRegularFile(candidate)) ? candidate : resolve(assets.root, "index.html");
  if (!(await isRegularFile(path))) {
    return new Response("Not Found", { status: 404 });
  }
  const file = Bun.file(path);
  const headers = staticHeaders(path);
  if (file.type.length > 0) {
    headers.set("Content-Type", file.type);
  }
  return new Response(request.method === "HEAD" ? null : file, { headers });
}

async function routeApi(
  request: Request,
  transport: StudioTransport,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/capabilities") {
    return jsonResponse(await transport.getCapabilities());
  }
  if (request.method === "GET" && path === "/api/manifest") {
    return jsonResponse(await transport.loadManifest());
  }

  const body = await readJsonBody(request);
  if (request.method === "PUT" && path === "/api/manifest") {
    return jsonResponse(await transport.saveManifest(requireString(body, "source")));
  }

  const source = requireString(body, "source");
  const jobId = optionalString(body, "jobId");
  if (request.method === "POST" && path === "/api/validate") {
    return jsonResponse(await transport.validateManifest(source));
  }
  if (request.method === "POST" && path === "/api/format") {
    return jsonResponse(await transport.formatManifest(source));
  }
  if (request.method === "POST" && path === "/api/render") {
    return jsonResponse(await transport.renderManifest(source, jobId));
  }
  if (request.method === "POST" && path === "/api/explain") {
    return jsonResponse(await transport.explainManifest(source, jobId));
  }
  if (request.method === "POST" && path === "/api/plan") {
    return jsonResponse(await transport.planManifest(source, jobId));
  }
  if (request.method === "POST" && path === "/api/apply") {
    return jsonResponse(
      await transport.applyManifest(source, jobId, optionalBoolean(body, "start")),
    );
  }
  if (request.method === "POST" && path === "/api/remove") {
    return jsonResponse(
      await transport.removeJob(
        source,
        requireString(body, "jobId"),
        optionalBoolean(body, "keepPlist"),
      ),
    );
  }
  if (request.method === "POST" && path === "/api/status") {
    return jsonResponse(await transport.getStatus(source, jobId));
  }
  if (request.method === "POST" && path === "/api/control") {
    const action = requireString(body, "action");
    if (action !== "start" && action !== "stop" && action !== "restart") {
      throw new StudioError("action must be start, stop, or restart.", {
        status: 400,
        code: "request.invalid-field",
      });
    }
    return jsonResponse(
      await transport.controlJob(source, requireString(body, "jobId"), action as ControlAction),
    );
  }
  if (request.method === "POST" && path === "/api/logs") {
    const stream = requireString(body, "stream");
    if (stream !== "stdout" && stream !== "stderr") {
      throw new StudioError("stream must be stdout or stderr.", {
        status: 400,
        code: "request.invalid-field",
      });
    }
    return jsonResponse(
      await transport.getLogs(
        source,
        requireString(body, "jobId"),
        stream as LogStream,
        optionalInteger(body, "tail", 200),
      ),
    );
  }
  if (request.method === "POST" && path === "/api/doctor") {
    return jsonResponse(await transport.doctor(source, jobId));
  }

  return jsonResponse({ error: { code: "route.not-found", message: "Not Found" } }, 404);
}

function openUrl(url: string): void {
  const command: [string, ...string[]] =
    process.platform === "darwin"
      ? ["/usr/bin/open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    const child = Bun.spawn(command, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    child.unref();
  } catch {
    // The URL is printed even when no desktop opener is available.
  }
}

export function startWebUiServer(options: WebUiServerOptions): RunningWebUiServer {
  if (!isLoopbackHost(options.host) && !options.allowRemote) {
    throw new StudioError(
      "Refusing to bind the mutation-capable Web UI to a non-loopback address without --allow-remote.",
      { status: 400, code: "server.remote-bind-denied" },
    );
  }

  const token = createToken();
  const staticAssets = findStaticAssets();
  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    hostname: options.host,
    port: options.port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        const authorization = request.headers.get("authorization");
        if (authorization !== `Bearer ${token}`) {
          return jsonResponse(
            { error: { code: "auth.invalid", message: "Invalid Web UI token." } },
            401,
          );
        }
        const origin = request.headers.get("origin");
        if (origin !== null) {
          let originUrl: URL;
          try {
            originUrl = new URL(origin);
          } catch {
            return jsonResponse(
              { error: { code: "origin.invalid", message: "Invalid request origin." } },
              403,
            );
          }
          if (originUrl.origin !== url.origin) {
            return jsonResponse(
              { error: { code: "origin.invalid", message: "Invalid request origin." } },
              403,
            );
          }
        }
        try {
          return await routeApi(request, options.transport);
        } catch (error) {
          return errorResponse(error);
        }
      }
      return serveStatic(request, staticAssets);
    },
  });

  const port = server.port;
  if (port === undefined) {
    void server.stop(true);
    throw new StudioError("Web UI server did not bind to a TCP port.", {
      code: "server.port-unavailable",
    });
  }
  const displayHost = options.host === "::1" ? "[::1]" : options.host;
  const publicUrl = `http://${displayHost}:${port}/`;
  const url = `${publicUrl}#token=${encodeURIComponent(token)}`;
  if (options.openBrowser) {
    openUrl(url);
  }
  return {
    url,
    publicUrl,
    host: options.host,
    port,
    stop: () => server.stop(true),
  };
}
