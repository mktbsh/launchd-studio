---
title: Use the horse.hsb label namespace and macOS Application Support for new manifests
status: accepted
date: 2026-08-09
model: Codex (GPT-5)
---

# Context

Launchd Studio currently derives labels under `dev.launchd-studio`, which makes the reserved Web UI agent appear as `dev.launchd-studio.web-ui`. New manifests are also created in the current directory when no path is supplied, while the application already stores its managed state, token, and backups under macOS Application Support.

The product is macOS-specific and has no existing users requiring an automatic migration. The attribution app's bundle identity is already released and must remain stable; only LaunchAgent labels need the new namespace.

# Decision

Use `horse.hsb.launchd-studio` as the namespace for generated labels. The reserved Web UI label is `horse.hsb.launchd-studio.web-ui`. Keep the attribution app bundle identifier `dev.launchd-studio.app` unchanged.

Make `launchd-studio init` without an explicit path create:

```text
~/Library/Application Support/launchd-studio/launchd-studio.json
~/Library/Application Support/launchd-studio/launchd-studio.schema.json
```

Keep `--config` and the existing current-directory/parent-directory search for commands that load a manifest. Do not automatically move or rewrite an existing project-local manifest; users can clean up the old agent and file explicitly.

# Consequences

New implicit labels and new default manifests use the product-owned namespace and macOS-native storage. Existing explicit labels and project-local files remain valid until the user changes or removes them. The old `dev.launchd-studio.web-ui` agent therefore needs a one-time manual bootout before the new self-service agent is applied.
