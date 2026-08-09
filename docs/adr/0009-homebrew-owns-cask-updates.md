---
title: Homebrew owns updates for Homebrew-managed installations
status: accepted
date: 2026-08-09
model: Codex (GPT-5)
---

# Context

The release binary now supports signed self-update, while Homebrew manages installed files through its Caskroom and upgrade state. Replacing a Caskroom binary in place would make Homebrew's recorded version and the executable disagree.

# Decision

Detect Homebrew `Cellar` and `Caskroom` paths and skip binary self-installation there. Homebrew users update with `brew upgrade --cask launchd-studio`; direct GitHub Release installations retain the existing self-update behavior.

# Consequences

The tap can distribute the signed release binary without two package managers competing for ownership. A Homebrew installation may report an available upstream update until the tap Cask is bumped.
