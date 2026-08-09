#!/usr/bin/env bash
set -euo pipefail

repository="mktbsh/launchd-studio"

if [[ -z "${HOME:-}" ]]; then
  printf 'HOME is not set.\n' >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'launchd-studio supports macOS only.\n' >&2
  exit 1
fi

case "$(uname -m)" in
  arm64)
    architecture="arm64"
    ;;
  x86_64)
    architecture="x64"
    ;;
  *)
    printf 'Unsupported macOS architecture: %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

for command_name in curl gzip shasum codesign install mktemp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$command_name" >&2
    exit 1
  fi
done

install_directory="${INSTALL_DIR:-$HOME/.local/bin}"
binary_name="launchd-studio"
target_path="$install_directory/$binary_name"
archive_name="launchd-studio-darwin-$architecture.gz"
checksum_name="$archive_name.sha256"
download_base_url="https://github.com/$repository/releases/latest/download"
temporary_directory=""
staged_path=""

cleanup() {
  if [[ -n "$temporary_directory" ]]; then
    rm -rf "$temporary_directory"
  fi
  if [[ -n "$staged_path" ]]; then
    rm -f "$staged_path"
  fi
}
trap cleanup EXIT

mkdir -p "$install_directory"
temporary_directory="$(mktemp -d -t launchd-studio-install)"
archive_path="$temporary_directory/$archive_name"
checksum_path="$temporary_directory/$checksum_name"

curl --fail --location --silent --show-error --retry 3 --retry-delay 1 \
  --output "$archive_path" "$download_base_url/$archive_name"
curl --fail --location --silent --show-error --retry 3 --retry-delay 1 \
  --output "$checksum_path" "$download_base_url/$checksum_name"

if ! (cd "$temporary_directory" && shasum -a 256 -c "$checksum_name"); then
  printf 'Downloaded archive failed checksum verification.\n' >&2
  exit 1
fi

binary_path="$temporary_directory/launchd-studio-darwin-$architecture"
gzip -cd "$archive_path" > "$binary_path"

if ! codesign --verify --strict "$binary_path"; then
  printf 'Downloaded binary failed code-signature verification.\n' >&2
  exit 1
fi

staged_path="$(mktemp "$install_directory/.launchd-studio.XXXXXX")"
install -m 0755 "$binary_path" "$staged_path"
mv -f "$staged_path" "$target_path"
staged_path=""

printf 'Installed %s (%s) to %s\n' "$binary_name" "$architecture" "$target_path"
"$target_path" version

case ":${PATH:-}:" in
  *:"$install_directory":*)
    ;;
  *)
    printf 'Warning: %s is not in PATH.\n' "$install_directory" >&2
    printf 'Run: export PATH="%s:$PATH"\n' "$install_directory" >&2
    printf 'Add the same line to ~/.zprofile to keep it after restarting the shell.\n' >&2
    ;;
esac
