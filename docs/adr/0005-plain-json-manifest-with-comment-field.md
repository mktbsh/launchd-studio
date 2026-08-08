---
title: Plain JSON manifest with a per-job comment field
status: accepted
date: 2026-08-08T15:35Z
model: Opus 5
supersedes: 0001-intent-based-jsonc-manifest
---

# Context

ADR 0001 chose JSONC so that a hand-edited manifest could carry rationale as `//` comments. The Web UI redesign makes the manifest text a derived artifact rather than the primary editing surface: the user edits forms, changes are staged, and an explicit Apply writes the manifest back.

That inverts the cost of comments. A form UI must serialize its state to manifest text on every change, and comments live between tokens, not in the value tree — so any writer either loses them or needs an edit-based writer over a CST. Measured on the two candidate libraries:

- `confbox@0.2.4` parses JSONC but its own types state that `stringifyJSONC` does not preserve comments — a round trip through the Web UI would silently delete every comment in the file.
- `jsonc-parser@3.3.1` preserves comments through `modify` + `applyEdits`, at the cost of routing every write through path-addressed edits instead of serializing a value. It also produces invalid output when removing the last remaining property of an object that has a trailing comma.

Meanwhile `packages/core/src/manifest/jsonc.ts` is 470 hand-rolled lines (comment stripper, trailing-comma stripper, tokenizer, comment-preserving formatter) that exist solely to support comments.

# Decision

The manifest is plain JSON. Rationale moves from syntax into the schema.

- The manifest file is `launchd-studio.json`; `examples/services.json` follows.
- `parseJsonc`/`formatJsonc` and `packages/core/src/manifest/jsonc.ts` are removed. Parsing is `JSON.parse`; formatting is `JSON.stringify(value, null, 2)`. The existing `JSON.parse`-error-to-`Diagnostic` conversion (offset, line, column) is kept.
- `BaseJobDefinition` gains `readonly comment?: string`, alongside the existing `description`. The two carry different things:
  - `description` — what the job is, shown in the Web UI job list and in `explain`.
  - `comment` — why it is configured this way; the replacement for the `//` note a hand-editor would have written.
- Comments are per job, not per field. A per-field `comments` map would key free-form strings to field names with nothing keeping them in sync when a field is renamed or removed, which the type system cannot express.
- No new runtime dependency is added.

# Consequences

Every comment in an existing `launchd-studio.jsonc` is lost on migration unless the author moves it into a `comment` field by hand; no automatic migration is provided. Trailing commas and comments become syntax errors, which the Web UI surfaces as diagnostics like any other.

In exchange, the Web UI can round-trip form state through `JSON.stringify` with no CST, no edit-path addressing, and no library. Rationale becomes structured data — addressable by the form UI, visible in `explain`, and validated like every other field — instead of a comment the tooling can only preserve or drop.
