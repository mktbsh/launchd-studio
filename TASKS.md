---
title: Launchd Studio work tracker
updated: 2026-08-09
---

# v0.1.0 attribution app

- [x] T01 [blocks T03, T04, T05] Add an optional renderer seam for `AssociatedBundleIdentifiers` and apply it only to the reserved self-service job.
- [x] T02 [blocks T03, T04, T05] Build the signed `Launchd Studio.app` staging artifact from the release binary and expose a package command.
- [x] T03 [depends T02] Extend the release workflow with app signing, notarization, checksums, and a tarball containing both CLI and app.
- [x] T04 [depends T03] Update `install.sh` to verify and install the CLI plus app without changing the CLI self-update path.
- [~] T05 [depends T03] Update the Homebrew cask to install the app and expose the standalone CLI binary after the v0.1.0 asset checksum exists.
- [x] T06 [blocks T07] Add a Changeset that promotes the fixed package group to `0.1.0`.
- [~] T07 [depends T01, T02, T03, T04, T05, T06] Run focused tests, full checks, artifact inspection, and release-readiness checks.
- [ ] T08 [depends T07] After the `v0.1.0` Release and cask update are live, delete old GitHub Release objects/assets and retain Git tags.
