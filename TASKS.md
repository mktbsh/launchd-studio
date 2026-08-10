---
title: Launchd Studio work tracker
updated: 2026-08-10
---

# v0.1.0 attribution app

- [x] T01 [blocks T03, T04, T05] Add an optional renderer seam for `AssociatedBundleIdentifiers` and apply it only to the reserved self-service job.
- [x] T02 [blocks T03, T04, T05] Build the signed `Launchd Studio.app` staging artifact from the release binary and expose a package command.
- [x] T03 [depends T02] Extend the release workflow with app signing, notarization, checksums, and a tarball containing both CLI and app.
- [x] T04 [depends T03] Update `install.sh` to verify and install the CLI plus app without changing the CLI self-update path.
- [x] T05 [depends T03] Update the Homebrew cask to install the app and expose the standalone CLI binary after the v0.1.0 asset checksum exists.
- [x] T06 [blocks T07] Add a Changeset that promotes the fixed package group to `0.1.0`.
- [x] T07 [depends T01, T02, T03, T04, T05, T06] Run focused tests, full checks, artifact inspection, and release-readiness checks.
- [x] T08 [depends T07] After the `v0.1.0` Release and cask update are live, delete old GitHub Release objects/assets and retain Git tags.

# label namespace and macOS manifest location

- [x] T09 [blocks T11] Change generated labels and the reserved self-service label to the `horse.hsb.launchd-studio` namespace without changing the attribution app bundle ID.
- [x] T10 [blocks T11] Make `init` without an explicit path create the manifest and schema in macOS Application Support, while retaining project search and `--config`.
- [x] T11 [depends T09, T10] Add focused tests for label derivation and manifest path resolution.
- [x] T12 [depends T11] Update README and provide manual cleanup steps for the old `dev.launchd-studio.web-ui` agent and project-local manifest.

# single canonical user manifest

- [x] T13 [blocks T14] Make the macOS Application Support manifest the only CLI manifest source, independent of cwd.
- [x] T14 [depends T13] Remove `--config` and the optional `init` path from the public CLI interface.
- [x] T15 [depends T13] Generate the self-service LaunchAgent without a manifest argument.
- [x] T16 [depends T14, T15] Update tests, README, CONTEXT, ADR, and migration instructions.

# tokenless loopback-only Web UI

- [x] T17 [blocks T18] Record the loopback-only, tokenless Web UI boundary and accepted local-user risk in ADR 0013.
- [x] T18 [depends T17, blocks T19] Remove remote binding and bearer-token handling from the CLI, server, browser transport, and focused tests.
- [x] T19 [depends T18] Update user documentation and verify the full check plus standalone Web UI boundary.
