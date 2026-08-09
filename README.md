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
- authenticated localhost Web UI served by the CLI, installable as a login service from its own Overview
- signed self-update checks for the compiled macOS binary
- mise and Homebrew detection for a job's `PATH`
- Vite output embeddable in a standalone Bun executable

## Requirements

Development requires Bun 1.3.x. Runtime mutation commands require macOS and a logged-in GUI user session. Validation and rendering are cross-platform.

## Install from GitHub Releases

Install the latest signed and notarized binary on macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/mktbsh/launchd-studio/main/install.sh | bash
```

The installer puts the binary in `~/.local/bin`. Set `INSTALL_DIR` to use another directory.

It also installs the signed `Launchd Studio.app` attribution bundle in `~/Applications` so the self-service LaunchAgent appears as Launchd Studio in macOS background activity settings.

Each GitHub Release also includes a gzip-compressed self-update binary and a tarball containing the CLI plus attribution app, each with a SHA-256 checksum.

## Install with Homebrew

Install the signed and notarized Cask from the [mktbsh/homebrew-tap](https://github.com/mktbsh/homebrew-tap) tap:

```bash
brew tap mktbsh/tap
brew install --cask launchd-studio
```

The Cask installs both the CLI and `Launchd Studio.app`; Homebrew-managed installations update with `brew upgrade --cask launchd-studio`.

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

`bun run package:app` stages the attribution app around the compiled binary for release packaging.

## Quick start

Create a manifest:

```bash
bun run apps/cli/src/main.ts init
```

`init` writes both `launchd-studio.json` and `launchd-studio.schema.json` so editor completion works without relying on a hosted schema URL. The generated manifest has no jobs; `examples/services.json` shows the shape of a populated one.

Validate, inspect, and apply it:

```bash
bun run apps/cli/src/main.ts validate
bun run apps/cli/src/main.ts render <job>
bun run apps/cli/src/main.ts explain <job>
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

`workingDirectory` becomes the process's current directory, so relative arguments in `command` resolve against it. Avoid `~/Desktop`, `~/Documents`, and `~/Downloads`: macOS withholds those from a LaunchAgent unless the executable itself has been granted Full Disk Access, and the job dies at startup with a *current directory is not accessible* error.

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
update [--check]            Check for or install a signed release update
web-ui                      Start the local Web UI
version                     Print the version
```

Use `--json` for machine-readable output. `apply --dry-run` is equivalent to a plan. `apply` never deletes omitted jobs; use `remove` explicitly.

After a successful registration, Launchd Studio stores only ownership metadata and the generated plist hash in:

```text
~/Library/Application Support/launchd-studio/state.json
```

The JSON manifest remains the source of truth. The state file lets `plan` conservatively reload a loaded definition that was not registered by the current manifest, and lets `remove <job>` clean up a previously applied job even after that job was deleted from the manifest.

`update` checks the latest GitHub Release for the current macOS architecture. It verifies the gzip size and SHA-256, the downloaded executable's code signature and Team ID, then replaces the current binary atomically. `update --check` only reports availability. A compiled binary started with `web-ui` performs the same check once before serving; use `web-ui --no-update` to skip it. Homebrew-managed installations are updated with `brew upgrade --cask launchd-studio` and do not replace their Caskroom binary in place. Source execution and unsupported platforms do not self-update.

## Web UI

The Vite application runs only against the localhost API served by `web-ui`; it has no standalone browser mode. Without the bearer token it renders a single message pointing back at the CLI. `bun run dev:web` therefore needs a running `web-ui` and the token in the URL fragment.

`web-ui` binds to `127.0.0.1:43210`. Override the port with `--port` or `LAUNCHD_STUDIO_PORT`; `--port 0` picks a free one. The bearer token is generated once and kept at `~/Library/Application Support/launchd-studio/web-ui-token` with mode `0600`, so the URL survives a restart. The CLI opens a URL carrying that token in the fragment, the page stores it in same-tab `sessionStorage`, removes the fragment from browser history, and every API request is origin-checked. Remote binding requires `--allow-remote` and is not recommended.

### Run it at login

The Overview offers **Run Launchd Studio at login**, which stages a `launchd-studio` service running `web-ui` on the fixed port against the current manifest. Nothing is written until you install the staged change. The signed attribution app associates this reserved LaunchAgent with the Launchd Studio name in macOS background activity settings. The bookmark is `http://127.0.0.1:43210/`; the token is added on first visit from the CLI-opened URL.

### Toolchain paths

launchd hands a job only the system `PATH`. A job's environment editor offers one checkbox per detected toolchain, each putting its directory in front of the job's `PATH`:

| Checkbox | Detected at |
| --- | --- |
| Use mise shims | `<MISE_DATA_DIR or ~/.local/share/mise>/shims` |
| Use Homebrew | the first of `$HOMEBREW_PREFIX`, `/opt/homebrew`, `/usr/local` with an executable `bin/brew` |

Executables in `command` still have to be absolute: launchd resolves nothing through `PATH`, which only applies to what the job itself spawns. When the executable box holds a bare name, the command editor offers **Resolve in …** for each detected toolchain, which rewrites it to that directory's absolute path.

## Repository layout

```text
.
├── apps/
│   ├── cli/                  Bun CLI, launchctl adapter, local API
│   └── web/                  Vite host and the local HTTP transport
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
