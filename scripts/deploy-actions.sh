#!/usr/bin/env bash
set -Eeuo pipefail

: "${DEPLOY_HOST:?Set DEPLOY_HOST secret}"
: "${DEPLOY_USER:?Set DEPLOY_USER secret}"
: "${DEPLOY_SSH_KEY:?Set DEPLOY_SSH_KEY secret}"
: "${DEPLOY_KNOWN_HOSTS:?Set DEPLOY_KNOWN_HOSTS secret}"
: "${RELEASE_ID:?RELEASE_ID is required}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/srv/markdown-blog}"
# Restrict arguments before sending them through the remote login shell.
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid host (use hostname or IPv4)' >&2; exit 1; }
[[ "$DEPLOY_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || exit 1
[[ "$DEPLOY_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$DEPLOY_PORT > 0 && 10#$DEPLOY_PORT < 65536)) || exit 1
[[ "$DEPLOY_ROOT" =~ ^/[a-zA-Z0-9_/-]+$ && "$DEPLOY_ROOT" != / ]] || exit 1
[[ "$RELEASE_ID" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
[[ -s dist/index.html ]] || { echo 'Missing dist/index.html' >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" > "$tmp/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$tmp/known_hosts"
ssh_options=(-i "$tmp/key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$tmp/known_hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
target="$DEPLOY_USER@$DEPLOY_HOST"
archive="$DEPLOY_ROOT/.upload-$RELEASE_ID.tar.gz"
tar -czf "$tmp/site.tar.gz" -C dist .
ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$target" "mkdir -p -- '$DEPLOY_ROOT'"
scp "${ssh_options[@]}" -P "$DEPLOY_PORT" "$tmp/site.tar.gz" "$target:$archive"
ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$target" "bash -s -- '$DEPLOY_ROOT' '$RELEASE_ID'" < scripts/activate-release.sh
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Published release `%s`. Previous releases were retained.\n' "$RELEASE_ID" >> "$GITHUB_STEP_SUMMARY"
fi
