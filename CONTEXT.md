---
title: Launchd Studio context
updated: 2026-08-09
---

# Terms

- **CLI executable**: The command users invoke directly. It owns the Web UI process and signed self-update.
- **Self-service LaunchAgent**: The reserved user-scoped LaunchAgent that keeps Launchd Studio's Web UI available at login.
- **Attribution app**: The signed macOS app identity associated with the self-service LaunchAgent for background-activity display. It is not a second runtime owner.
