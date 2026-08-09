# @launchd-studio/cli

## 0.1.2

### Patch Changes

- 2675319: Use one canonical macOS Application Support manifest and remove cwd-dependent configuration selection.
- Updated dependencies [2675319]
  - @launchd-studio/core@0.1.2

## 0.1.1

### Patch Changes

- 646240a: Use the `horse.hsb.launchd-studio` LaunchAgent namespace and create new default manifests in macOS Application Support.
- Updated dependencies [646240a]
  - @launchd-studio/core@0.1.1

## 0.1.0

### Minor Changes

- dc1c748: Ship a signed Launchd Studio app bundle so the self-service LaunchAgent is displayed as Launchd Studio in macOS background activity settings.

### Patch Changes

- Updated dependencies [dc1c748]
  - @launchd-studio/core@0.1.0

## 0.0.8

### Patch Changes

- Package Homebrew archives with a neutral `launchd-studio` binary name.

## 0.0.6

### Patch Changes

- Keep Homebrew-managed installations under `brew upgrade` instead of replacing their Caskroom binary during self-update.
- Updated dependencies
  - @launchd-studio/core@0.0.6

## 0.0.5

### Patch Changes

- Add signed self-update support for compiled macOS binaries and the embedded Web UI.
- Updated dependencies
  - @launchd-studio/core@0.0.5

## 0.0.4

### Patch Changes

- 553a49d: Automate versioned signed binary releases with Changesets.
  - @launchd-studio/core@0.0.4
