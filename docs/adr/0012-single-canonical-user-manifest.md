---
title: Use one canonical user manifest for all CLI commands
status: accepted
date: 2026-08-09
model: Codex (GPT-5)
---

# Context

The CLI previously searched the current directory and its parents before falling back to macOS Application Support, and exposed `--config` and an optional path for `init`. That made the same `launchd-studio web-ui` command select different manifests depending on its working directory. A self-service LaunchAgent created from a project directory could therefore keep using a project-local manifest and lose the attribution-app renderer when its old label was loaded.

The product manages one user's LaunchAgents as a single local system. It does not need project-scoped manifest ownership or concurrent configuration sets.

# Decision

Treat this file as the canonical user manifest for every CLI command:

```text
~/Library/Application Support/launchd-studio/launchd-studio.json
```

Remove current-directory and parent-directory discovery, the `--config` option, and the optional `init` path. The self-service definition starts `web-ui` without a manifest argument, so its source of truth is independent of launchd's working directory.

Existing project-local manifests are not automatically rewritten. Users migrate their jobs into the canonical manifest and reapply the self-service definition once.

# Consequences

The CLI has one predictable manifest source and no cwd-dependent behavior. Tests can isolate the user manifest by supplying a temporary home directory to the internal service seam. Project-local `launchd-studio.json` files are ignored and can be removed after migration.
