#!/usr/bin/env bash
# Safely commit, integrate origin/main, and push the Wyvern feature branch.
set -Eeuo pipefail

readonly REPOSITORY='/home/axel/Wyvern-for-Workers/Wyvern/wyvern-workers'
readonly BRANCH='agent/wyvern-prelaunch'
readonly EXPECTED_ORIGIN='https://github.com/Wyvern-Organization/Wyvern.git'
readonly LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/wyvern-git-sync.lock"

log() {
    printf '%s [wyvern-git-sync] %s\n' "$(date --iso-8601=seconds)" "$*"
}

fail() {
    log "ERROR: $*"
    exit 1
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log 'Another sync is already running; skipping this invocation.'
    exit 0
fi

export GIT_TERMINAL_PROMPT=0

cd "$REPOSITORY" || fail "Repository directory is unavailable: $REPOSITORY"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail 'Configured directory is not a Git work tree.'
[[ "$(git rev-parse --show-toplevel)" == "$REPOSITORY" ]] || fail 'Git work tree does not match the configured repository.'
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail "Expected branch $BRANCH is not checked out."
[[ "$(git remote get-url origin)" == "$EXPECTED_ORIGIN" ]] || fail 'Origin does not match the expected GitHub repository.'

git add -A
if ! git diff --cached --quiet; then
    git commit -m "chore: automated sync $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    log 'Committed local non-ignored changes.'
else
    log 'No local non-ignored changes to commit.'
fi

git fetch --prune origin
git show-ref --verify --quiet "refs/remotes/origin/$BRANCH" || fail "Remote branch origin/$BRANCH does not exist."
git show-ref --verify --quiet refs/remotes/origin/main || fail 'Remote branch origin/main does not exist.'

git merge --ff-only "origin/$BRANCH" || fail "Cannot fast-forward from origin/$BRANCH; leaving the work tree unchanged."

if ! git merge --no-edit origin/main; then
    if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
        git merge --abort
    fi
    fail 'Could not merge origin/main; merge was aborted and local files were preserved.'
fi

git push origin "HEAD:refs/heads/$BRANCH"
log "Successfully synchronized and pushed $BRANCH."
