# Launchd Studio

Launchd Studio is an intent-based JSON compiler, CLI, and Web UI for macOS user LaunchAgents.

Instead of editing plist keys directly, define either a long-running `service` or a finite `task`. The tool validates the intent, renders deterministic plist XML, explains each mapping, compares desired/file/runtime state, and applies the result through `launchctl`.

> Status: v0.1 source delivery. Only user-scoped LaunchAgents are supported. LaunchDaemons are intentionally out of scope.

## Features

- plain JSON input with a per-job `comment` field for rationale
- JSON Schema for editor completion
- strict unknown-property and semantic validation
- deterministic plist rendering
- `service` and `task` job types
- login, manual, interval, and calendar activation
- `never`, `on-failure`, and `always` restart policies
- plan/apply without implicit prune
- managed-definition tracking for conservative runtime drift detection
- status, start, stop, restart, logs, and doctor commands
- browser-only preview application
- authenticated localhost Web UI served by the CLI
- Vite output embeddable in a standalone Bun executable

## Requirements

Development requires Bun 1.3.x. Runtime mutation commands require macOS and a logged-in GUI user session. Rendering and browser preview are cross-platform.

## Install and verify

```bash
bun install
bun run check
```

Run the CLI from source:

```bash
bun run apps/cli/src/main.ts help
```

Build the Web application and standalone executable:

```bash
bun run build
./dist/launchd-studio version
```

The executable contains the Vite production output. No separate Web asset directory is required at runtime.

## Quick start

Create a manifest:

```bash
bun run apps/cli/src/main.ts init
```

`init` writes both `launchd-studio.json` and `launchd-studio.schema.json` so editor completion works without relying on a hosted schema URL.

Validate, inspect, and apply it:

```bash
bun run apps/cli/src/main.ts validate
bun run apps/cli/src/main.ts render local-api
bun run apps/cli/src/main.ts explain local-api
bun run apps/cli/src/main.ts plan
bun run apps/cli/src/main.ts apply
```

Open the local Web UI:

```bash
bun run build:web
bun run apps/cli/src/main.ts web-ui
```

The CLI searches the current directory and parents for `launchd-studio.json` or `.launchd-studio.json`. Override it with `--config`.

## Manifest

```json
{
  "$schema": "./launchd-studio.schema.json",
  "version": 1,
  "jobs": {
    "local-api": {
      "kind": "service",
      "label": "dev.example.local-api",
      "description": "Local development API",
      "comment": "A process expected to stay alive.",
      "command": [
        "/opt/homebrew/bin/bun",
        "run",
        "src/index.ts"
      ],
      "workingDirectory": "~/src/local-api",
      "start": "login",
      "restart": "on-failure",
      "environment": {
        "NODE_ENV": "development"
      }
    },
    "daily-backup": {
      "kind": "task",
      "label": "dev.example.daily-backup",
      "command": ["~/.local/bin/backup"],
      "schedule": {
        "type": "calendar",
        "entries": [{ "hour": 3, "minute": 0 }]
      }
    }
  }
}
```

`description` is a short human-readable name; `comment` records why the job is set up the way it is. Neither affects the generated plist, and both survive a Web UI round trip.

Executable and path values must be absolute or begin with `~/`. Launchd Studio does not insert `sh -c` and does not inherit an interactive shell's PATH.

### Defaults

A service defaults to:

```json
{
  "start": "login",
  "restart": "on-failure",
  "throttleIntervalSeconds": 10
}
```

A manual service must explicitly use `restart: "never"`. Launchd implements restart policies through `KeepAlive`, which also implies an initial run when the agent is loaded.

A task defaults to `runAtLoad: false`. A task without a schedule is valid but receives a warning because it can run only through an explicit start.

Generated logs default to:

```text
~/Library/Logs/launchd-studio/<job-id>.stdout.log
~/Library/Logs/launchd-studio/<job-id>.stderr.log
```

A missing label is derived as `dev.launchd-studio.<job-id>` unless the job ID already contains a dot.

## CLI

```text
init [path]                 Create a starter manifest
validate                    Validate syntax and semantics
format [--write]            Format the manifest
render [job]                Render plist XML
explain [job]               Explain manifest-to-launchd mappings
plan [job]                  Compare desired, file, and runtime state
apply [job]                 Write and register LaunchAgents
remove <job>                Unload and remove a generated plist
status [job]                Show drift and launchd state
start <job>                 Load and kickstart an applied job
stop <job>                  Unload a job, including KeepAlive jobs
restart <job>               Force restart an applied job
logs <job>                  Read stdout or stderr logs
doctor [job]                Diagnose common configuration failures
web-ui                      Start the local Web UI
version                     Print the version
```

Use `--json` for machine-readable output. `apply --dry-run` is equivalent to a plan. `apply` never deletes omitted jobs; use `remove` explicitly.

After a successful registration, Launchd Studio stores only ownership metadata and the generated plist hash in:

```text
~/Library/Application Support/launchd-studio/state.json
```

The JSON manifest remains the source of truth. The state file lets `plan` conservatively reload a loaded definition that was not registered by the current manifest, and lets `remove <job>` clean up a previously applied job even after that job was deleted from the manifest.

## Web modes

The Vite application chooses its transport at startup.

- Browser preview: validates, formats, renders, and explains using `/Users/you` as a preview home path.
- CLI Web UI: reads and writes the selected manifest and exposes plan/apply/remove/status/control/log/doctor operations through a localhost API.

`web-ui` binds to `127.0.0.1` on a random port by default. It generates a random bearer token, opens a URL containing that token in the fragment, stores it only in same-tab `sessionStorage` for reloads, removes the fragment from browser history, and verifies request origin. Remote binding requires `--allow-remote` and is not recommended.

## Repository layout

```text
.
├── apps/
│   ├── cli/                  Bun CLI, launchctl adapter, local API
│   └── web/                  Vite host and transport implementations
├── packages/
│   ├── core/                 Pure domain, validation, rendering, planning
│   │   └── src/transport/    Shared transport contract and DTOs
│   └── web-ui/               React and Tailwind UI
├── schemas/                  JSON Schema
├── examples/                 Example manifests
└── docs/adr/                 Architecture decisions
```

## Safety and current limits

- v0.1 writes only to `~/Library/LaunchAgents`.
- No shell is inserted around commands. All strings rendered into plist XML are checked for valid XML 1.0 text characters.
- Generated plist is staged and checked with `plutil -lint` before application.
- Existing plist files are backed up before update.
- Omitted jobs are never pruned.
- Loaded definitions without matching managed-state metadata are treated as drift and reloaded on apply.
- LaunchAgent labels are global within the user's launchd domain; use stable reverse-DNS labels to avoid collisions.
- LaunchDaemon, MachServices, socket activation, raw plist keys, import, and rollback after every possible launchctl failure are not implemented yet.
- `StartCalendarInterval` follows local calendar time and launchd semantics; it is not a cron parser.

See `docs/adr/` for design decisions.
