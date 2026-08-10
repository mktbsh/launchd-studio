---
title: Tokenless loopback-only Web UI
status: accepted
date: 2026-08-10T22:39:43+09:00
model: GPT-5
---

# Context

The Web UI is a local interface for the current macOS user. Remote access is not a product requirement. Requiring a bearer token made the fixed URL unusable after the browser session ended, while `--allow-remote` preserved an unused and riskier operating mode.

# Decision

Bind the Web UI only to `127.0.0.1`. Remove `--host`, `--allow-remote`, token generation and storage, URL fragments, and authorization headers.

Reject requests whose Host is not `127.0.0.1`. Continue rejecting an Origin that does not match the request URL, and do not enable CORS.

This supersedes the bearer-token and remote-binding parts of ADR 0002 and the token parts of ADR 0007. Their remaining transport, embedding, fixed-port, and self-service decisions stay in force.

# Consequences

`http://127.0.0.1:43210/` works directly as a bookmark across browser sessions.

Another local account or process on the same Mac can reach the TCP port and act through the server process. Launchd Studio accepts that risk for its local single-user product boundary. Cross-user isolation would require a separate authentication or IPC decision.
