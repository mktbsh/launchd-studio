---
title: Keep Bun and update the compiled binary in place
status: accepted
date: 2026-08-09
model: Codex (GPT-5)
---

# Context

The standalone application already embeds and serves the Web UI through Bun. Migrating the runtime would replace a working packaging and serving path while leaving the actual product requirement — receiving new releases — unresolved.

# Decision

Keep Bun as the runtime and add signed self-update support for compiled macOS arm64 and x64 binaries.

The updater reads a small manifest from the latest GitHub Release, verifies the artifact size and SHA-256, verifies the downloaded code signature and its Team ID against the current binary, then atomically replaces the executable. `update --check` reports without installing; compiled `web-ui` performs one check at startup and accepts `--no-update` to skip it. A launchd-owned Web UI is restarted through its existing service after replacement.

# Consequences

The existing Bun embedded Web UI and build pipeline stay unchanged. Updates are limited to release artifacts produced by this repository and fail closed when the feed, platform, signature, or version check is invalid. The first release containing `latest.json` is required before existing binaries can discover updates.
