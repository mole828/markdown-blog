#!/usr/bin/env bash
# Runs on the Linux host; no Node.js or source checkout required.
set -Eeuo pipefail
root="${1:?Deployment root required}"
release="${2:?Release ID required}"
[[ "$root" =~ ^/[a-zA-Z0-9_/-]+$ && "$root" != / ]] || exit 1
[[ "$release" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
umask 022
mkdir -p "$root/releases"
exec 9>"$root/.deploy.lock"
flock -w 120 9
archive="$root/.upload-$release.tar.gz"
[[ -f "$archive" ]] || { echo 'Upload missing' >&2; exit 1; }
[[ ! -e "$root/releases/$release" ]] || { echo 'Release already exists' >&2; exit 1; }
[[ ! -e "$root/current" || -L "$root/current" ]] || { echo 'current must be a symlink' >&2; exit 1; }
stage="$(mktemp -d "$root/.stage-XXXXXX")"
next="$root/.current-$release"
cleanup() {
  rm -rf -- "$stage"
  rm -f -- "$next" "$archive"
}
trap cleanup EXIT
# The archive is produced from the trusted main branch's static build.
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$stage"
[[ -s "$stage/index.html" ]] || { echo 'Release missing index.html' >&2; exit 1; }
# Static releases must not link outside the published directory.
[[ -z "$(find "$stage" -type l -print -quit)" ]] || { echo 'Symlinks in artifact are not supported' >&2; exit 1; }
find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
mv -- "$stage" "$root/releases/$release"
# Relative target works both on the host and inside the existing Caddy mount.
ln -s "releases/$release" "$next"
mv -Tf -- "$next" "$root/current"
printf 'Activated %s\n' "$release"
