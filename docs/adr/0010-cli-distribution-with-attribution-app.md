---
title: Keep CLI distribution and add a thin attribution app for self-service
status: accepted
date: 2026-08-09
model: Codex (GPT-5)
---

# Context

Launchd Studio is distributed as a signed standalone CLI. When its reserved Web UI LaunchAgent runs continuously, macOS attributes the legacy background item to the organization name in the CLI's signing certificate because the LaunchAgent is not associated with an app bundle.

The product must remain CLI-first and retain the existing signed self-update path. Converting the runtime to an app bundle would make every update replace and re-sign an outer app bundle, while adding the association only to arbitrary user jobs would misattribute those jobs.

# Decision

Ship a thin, signed `Launchd Studio.app` alongside the standalone CLI. The app provides the display name `Launchd Studio`, bundle identifier `dev.launchd-studio.app`, and the matching Team ID. The self-service LaunchAgent adds `AssociatedBundleIdentifiers` for that bundle only; user-defined jobs remain unchanged.

The LaunchAgent continues to execute the standalone CLI path. GitHub's installer installs the CLI to its existing destination and the app to the user's `~/Applications`. The Homebrew cask installs both the CLI binary and the app from the same archive; Homebrew continues to own upgrades for that installation.

The raw gzip binary remains the self-update artifact. The Homebrew/direct-install tarball additionally contains the app bundle. The first release using this layout is `v0.1.0`. After it is published and the cask points to it, old GitHub Release objects and assets may be deleted while Git tags remain.

# Consequences

The manifest format does not gain an app-association field. The CLI renderer adds the association only for the reserved self-service job, keeping the public job model and arbitrary LaunchAgent output stable.

The installer and release workflow must verify both the standalone binary and the signed app bundle. The app contains a copy of the CLI as its valid main executable, but the self-service process and self-update continue to use the standalone CLI artifact.
