---
title: Intent-based JSONC manifest for user LaunchAgents
status: accepted
date: 2026-08-08
model: GPT-5.6 Pro
---

# Context

Raw launchd plist keys expose platform mechanics before user intent. Form-based plist editors improve XML entry but still require users to understand combinations such as `RunAtLoad`, `KeepAlive`, and `StartCalendarInterval`.

# Decision

Launchd Studio v0.1 uses a versioned JSONC manifest with two job kinds:

- `service`: a process expected to remain alive
- `task`: a finite process started manually or by a schedule

The manifest accepts only `scope: "user"`. It compiles to a LaunchAgent under `~/Library/LaunchAgents`. Commands are argv arrays and never gain an implicit shell. Unknown properties are errors. JSON Schema assists editors, while runtime semantic validation remains authoritative.

# Consequences

The model prevents several invalid or surprising launchd combinations and supports human-readable explanations. It intentionally does not expose every plist key. LaunchDaemons, socket activation, Mach services, and raw plist escape hatches require later design decisions.
