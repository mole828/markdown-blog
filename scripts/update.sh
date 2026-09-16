#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  printf 'Usage: %s [--no-pull]\n' "${0##*/}"
  printf '\n'
  printf 'Update the checked-out blog, build dist, and atomically publish a release.\n'
  printf 'DEPLOY_ROOT defaults to /srv/markdown-blog and must be absolute.\n'
}

die() {
  printf 'update: %s\n' "$*" >&2
  exit 1
}

pull=true
while (($# > 0)); do
  case "$1" in
    --no-pull)
      pull=false
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
  shift
done

DEPLOY_ROOT="${DEPLOY_ROOT:-/srv/markdown-blog}"
[[ "$DEPLOY_ROOT" == /* ]] || die "DEPLOY_ROOT must be an absolute path: $DEPLOY_ROOT"
[[ "$DEPLOY_ROOT" != "/" ]] || die "DEPLOY_ROOT must not be /"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

git -C "$REPO_ROOT" rev-parse --show-toplevel >/dev/null 2>&1 \
  || die "repository not found: $REPO_ROOT"
command -v npm >/dev/null 2>&1 || die "npm is required"
command -v flock >/dev/null 2>&1 || die "flock is required on the Linux deployment host"

mkdir -p -- "$DEPLOY_ROOT/releases"
exec 9>"$DEPLOY_ROOT/.update.lock"
flock -n 9 || die "another update is already running"

stage=''
next_link=''
cleanup() {
  local exit_code=$?
  if [[ -n "$next_link" && -L "$next_link" ]]; then
    rm -f -- "$next_link"
  fi
  if [[ -n "$stage" && -d "$stage" ]]; then
    rm -rf -- "$stage"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

assert_clean() {
  local status
  status="$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all --ignored=no)" \
    || die "unable to inspect git worktree"
  if [[ -n "$status" ]]; then
    printf '%s\n' "$status" >&2
    die "git worktree contains tracked or untracked changes"
  fi
}

assert_clean

if [[ "$pull" == true ]]; then
  git -C "$REPO_ROOT" pull --ff-only
  assert_clean
fi

(
  cd -- "$REPO_ROOT"
  npm ci
  npm run build
)

[[ -d "$REPO_ROOT/dist" ]] || die "build did not produce $REPO_ROOT/dist"

commit="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)" \
  || die "unable to determine the deployed commit"
release_name="$(date -u +%Y%m%d%H%M%S)-${commit}-${BASHPID}"
release_dir="$DEPLOY_ROOT/releases/$release_name"
stage="$(mktemp -d "$DEPLOY_ROOT/.release-stage.XXXXXX")" \
  || die "unable to create release staging directory"
cp -a -- "$REPO_ROOT/dist/." "$stage/"
mv -- "$stage" "$release_dir"
stage=''

next_link="$DEPLOY_ROOT/.current.${release_name}.tmp"
ln -s -- "$release_dir" "$next_link"
mv -Tf -- "$next_link" "$DEPLOY_ROOT/current"
next_link=''

printf 'Published %s\n' "$release_dir"
