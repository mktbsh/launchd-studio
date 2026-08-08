---
title: Track applied runtime definitions with minimal local state
status: accepted
date: 2026-08-08
model: GPT-5.6 Pro
---

# Context

The plist on disk and the definition already registered in launchd are separate states. A matching plist file does not prove that launchd loaded that exact content. Launchd Studio also needs a safe way to remove a previously applied job after the job has been deleted from its manifest.

# Decision

After a successful `launchctl bootstrap`, Launchd Studio records the job ID, label, plist path, manifest path, generated plist SHA-256 hash, and application timestamp in `~/Library/Application Support/launchd-studio/state.json`. The file is written atomically with mode `0600`.

The manifest remains the source of truth. Managed state is auxiliary ownership evidence, not Terraform-style resource state. A loaded job is considered synchronized only when its desired plist file matches and its managed-state record matches the current manifest and generated plist hash. Missing or mismatched evidence produces a conservative reload plan.

`remove <job>` first resolves the current manifest and then falls back to an exact job ID and manifest path match in managed state. This permits explicit cleanup after a job has been omitted without introducing implicit prune behavior.

# Consequences

Launchd Studio can distinguish file synchronization from known runtime-definition synchronization and can clean up omitted managed jobs. Jobs loaded outside Launchd Studio are intentionally treated as untracked. Deleting or corrupting the state file does not alter launchd or plist files, but the next plan reloads loaded jobs conservatively. Moving a manifest prevents fallback removal until the job is restored in the manifest or the state is migrated manually.
