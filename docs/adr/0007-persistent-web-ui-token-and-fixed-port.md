---
title: Persistent Web UI token on a fixed port
status: accepted
date: 2026-08-09
model: Claude Opus 5
---

> The token decisions are superseded by ADR 0013. The fixed-port and self-service decisions remain in force.

# Context

The Web UI is meant to be installable as a LaunchAgent so it is simply always there. A per-start random token on a random port makes that useless: the URL changes on every restart and the only copy of the token is the job's stdout log.

# Decision

`web-ui` binds `127.0.0.1:43210` by default, overridable with `--port` or `LAUNCHD_STUDIO_PORT`; `--port 0` keeps the old random behaviour.

The bearer token is generated once and stored at `~/Library/Application Support/launchd-studio/web-ui-token` with mode `0600`, next to the managed state. Every later start reuses it, so `http://127.0.0.1:43210/` is bookmarkable once the browser session has the token.

`getCapabilities` additionally returns a ready-made `launchd-studio` service definition — the current executable, `web-ui`, the resolved manifest path, the fixed port, `--no-open` — and the detected toolchain directories (mise shims, Homebrew `bin`) a job can put on its `PATH`. The Web UI stages that definition on request; installing it stays an explicit user action through the normal apply path.

# Consequences

A token readable by the user's own account is now at rest on disk. That is the same trust boundary the manifest, the generated plists, and `launchctl` itself already sit behind, and the alternative in practice was the token sitting in a log file instead.

A fixed default port can collide, in which case the bind fails and `--port` is the answer. A job installed from the Web UI hard-codes the executable path that produced it: a moved binary, or a source checkout used to generate the job, has to be reinstalled.
