---
title: Form-first Web UI with staged apply
status: accepted
date: 2026-08-09T00:20Z
model: Opus 5
---

# Context

The v0.1 Web UI was a manifest text area with a diagnostics list beside it. Every task — renaming a job, changing a schedule, adding an environment variable — required the user to know the manifest syntax, and the only feedback was a validation error after the fact. That makes the UI strictly worse than an editor with the JSON Schema attached, so it had no reason to exist.

The manifest format is an internal contract. A user who opens the Web UI wants to see whether their jobs are running and change how they run; the file that encodes it is an implementation detail.

# Decision

The manifest text stops being the editing surface.

- **Form-first.** Each job is edited through a settings-style inspector grouped by question — *What it runs*, *When it runs*, *If it stops*, *Notes* — not by manifest field order. Domain concepts get domain controls: a segmented control for `service` vs `task`, a weekday select plus `<input type="time">` for a calendar entry, argv boxes for `command`. The manifest is reachable through one button in the sidebar footer, read-only.
- **Staged changes, explicit apply.** Edits mutate an in-memory draft. The sidebar footer counts what differs from the last-saved manifest and offers a single Install action; nothing touches launchd until it is pressed. Apply order is removals first (issued against the *saved* source, since `removeJob` resolves the job from the source it is handed) → save → apply.
- **Status page as the landing view.** The top-level view is an overview of job health — one headline, a count per state, one card per job — rather than an empty editor.
- **Capability-gated controls.** Start/stop/restart/logs/install render only when the transport reports the capability. In the browser-only transport the Install action degrades to *Copy manifest*, so the UI stays honest instead of offering a button that cannot work.
- **Round trip through the value tree.** Form state is serialized with `JSON.stringify` and handed to the existing transport methods, which all take a `source: string`. No new transport surface is added. `$schema` is carried through the draft because validation drops it.

# Consequences

The form can only express what the schema models; a manifest using a field the form does not render still round-trips (the draft is a value tree, not a projection), but it is not editable in the UI. A manifest that fails to parse has no draft to show, so the raw-source sheet opens instead — the one path where the text is still primary.

Optional properties are dropped rather than set to `undefined`, since the draft is serialized straight to JSON. This is enforced in `packages/web-ui/src/app/job.ts` and is the reason those helpers exist instead of plain spreads.

The prototype that settled the layout question (three variants, one route) is preserved on the `prototype/web-ui-usability` branch and deleted from the working tree.
