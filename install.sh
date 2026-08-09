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

for command_name in curl shasum codesign install mktemp tar ditto; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$command_name" >&2
    exit 1
  fi
done

install_directory="${INSTALL_DIR:-$HOME/.local/bin}"
binary_name="launchd-studio"
target_path="$install_directory/$binary_name"
app_install_directory="$HOME/Applications"
app_target_path="$app_install_directory/Launchd Studio.app"
archive_name="launchd-studio-darwin-$architecture.tar.gz"
checksum_name="$archive_name.sha256"
download_base_url="https://github.com/$repository/releases/latest/download"
temporary_directory=""
staged_path=""
app_stage_directory=""

cleanup() {
  if [[ -n "$temporary_directory" ]]; then
    rm -rf "$temporary_directory"
  fi
  if [[ -n "$staged_path" ]]; then
    rm -f "$staged_path"
  fi
  if [[ -n "$app_stage_directory" ]]; then
    rm -rf "$app_stage_directory"
  fi
}
trap cleanup EXIT

mkdir -p "$install_directory" "$app_install_directory"
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

archive_directory="$temporary_directory/archive"
mkdir -p "$archive_directory"
tar -xzf "$archive_path" -C "$archive_directory"
binary_path="$archive_directory/launchd-studio"
app_path="$archive_directory/Launchd Studio.app"

if [[ ! -x "$binary_path" || ! -x "$app_path/Contents/MacOS/launchd-studio" ]]; then
  printf 'Downloaded archive does not contain the CLI and attribution app.\n' >&2
  exit 1
fi

if ! codesign --verify --strict "$binary_path"; then
  printf 'Downloaded binary failed code-signature verification.\n' >&2
  exit 1
fi

if ! codesign --verify --deep --strict "$app_path"; then
  printf 'Downloaded attribution app failed code-signature verification.\n' >&2
  exit 1
fi

staged_path="$(mktemp "$install_directory/.launchd-studio.XXXXXX")"
install -m 0755 "$binary_path" "$staged_path"
mv -f "$staged_path" "$target_path"
staged_path=""

app_stage_directory="$(mktemp -d "$app_install_directory/.launchd-studio-app.XXXXXX")"
ditto "$app_path" "$app_stage_directory/Launchd Studio.app"
rm -rf "$app_target_path"
mv "$app_stage_directory/Launchd Studio.app" "$app_target_path"
app_stage_directory=""

printf 'Installed %s (%s) to %s\n' "$binary_name" "$architecture" "$target_path"
printf 'Installed Launchd Studio.app to %s\n' "$app_target_path"
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
