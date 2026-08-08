---
title: Explicit apply, stop, and removal semantics
status: accepted
date: 2026-08-08
model: GPT-5.6 Pro
---

# Context

Implicit deletion during reconciliation can remove unrelated or temporarily omitted jobs. A KeepAlive job also cannot be reliably stopped by sending a process signal because launchd may immediately restart it.

# Decision

`apply` creates or updates only jobs present in the selected manifest. It never prunes omitted jobs. `remove <job>` explicitly unloads the service and removes its generated plist unless `--keep-plist` is used. `stop <job>` unloads the LaunchAgent; `start` loads the existing plist when necessary and then kickstarts it.

# Consequences

Destructive behavior remains visible and reversible. Full desired-state pruning may be added later only behind a separate explicit command or flag with an ownership model.
