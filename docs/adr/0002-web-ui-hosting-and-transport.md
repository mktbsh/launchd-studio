---
title: Shared React Web UI with browser and local transports
status: accepted
date: 2026-08-08
model: GPT-5.6 Pro
---

# Context

The project needs a public Web application for editing and previewing manifests and a local Web UI capable of reading files and controlling launchd. Browsers cannot access launchctl directly.

# Decision

`packages/web-ui` contains environment-independent React UI. It depends only on the `StudioTransport` contract from `packages/core/transport`.

`apps/web` provides two transport implementations:

- browser transport: parse, validate, format, render, and explain only
- HTTP transport: calls the authenticated localhost API hosted by the CLI

The Vite production output is embedded into the compiled Bun CLI as file-loader entrypoints by `scripts/build-binary.ts`. The CLI serves those files from `Bun.embeddedFiles` when no disk asset root is available; `LAUNCHD_STUDIO_WEB_DIST` and the development output remain valid disk-root overrides. `web-ui` binds to loopback by default, uses a random bearer token carried in the URL fragment, rejects invalid origins, and does not enable CORS.

## Amendment (2026-08-08, GPT-5)

Bun 1.3.14 does not provide the former `--asset` command shape used by the initial source delivery. The build now passes generated Web files as argv entrypoints with `.html` and `.js` file loaders, and runtime serving uses the embedded file names to preserve the Vite `assets/` URL paths.

# Consequences

One UI supports both modes without coupling React components to fetch, Bun, or launchctl. The local server is mutation-capable, so remote binding remains an explicit unsafe-by-default option.
