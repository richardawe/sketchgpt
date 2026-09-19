#!/usr/bin/env bash
# One-command setup: push this repo to GitHub, turn on Pages, wait for the
# deploy, print the URL.
#
# This uses YOUR gh credentials. A workflow's GITHUB_TOKEN cannot create a
# Pages site — it fails with "Resource not accessible by integration" — which
# is why this runs locally rather than in CI.
#
# Usage:
#   scripts/setup-pages.sh                 # use the current repo/remote
#   scripts/setup-pages.sh my-chat         # create a new public repo first

set -euo pipefail

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null 2>&1 || die "the GitHub CLI is required: https://cli.github.com"
gh auth status >/dev/null 2>&1 || die "run 'gh auth login' first"

NEW_NAME="${1:-}"

if [ -n "$NEW_NAME" ]; then
  log "creating public repo $NEW_NAME"
  gh repo create "$NEW_NAME" --public --source=. --remote=origin --push
else
  git remote get-url origin >/dev/null 2>&1 \
    || die "no 'origin' remote. Pass a name to create one: scripts/setup-pages.sh my-chat"
  log "pushing to the existing origin"
  git push -u origin HEAD
fi

SLUG="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
log "repo: $SLUG (branch $BRANCH)"

# The workflow only fires for its configured branch; keep them in step.
WF=".github/workflows/pages.yml"
if [ -f "$WF" ] && ! grep -q "branches: \[$BRANCH\]" "$WF"; then
  log "pointing the deploy workflow at $BRANCH"
  python3 - "$WF" "$BRANCH" <<'PY'
import re, sys
path, branch = sys.argv[1], sys.argv[2]
src = open(path).read()
open(path, "w").write(re.sub(r"branches: \[[^\]]*\]", f"branches: [{branch}]", src, count=1))
PY
  git add "$WF"
  git commit -qm "Point Pages deploy at $BRANCH" && git push -q origin "$BRANCH"
fi

log "enabling Pages (source: GitHub Actions)"
if gh api "repos/$SLUG/pages" >/dev/null 2>&1; then
  log "Pages already enabled"
  gh api -X PUT "repos/$SLUG/pages" -f "build_type=workflow" >/dev/null 2>&1 \
    || warn "could not switch the source to Actions; check Settings > Pages"
else
  gh api -X POST "repos/$SLUG/pages" -f "build_type=workflow" >/dev/null 2>&1 \
    || die "could not enable Pages. Enable it once by hand: Settings > Pages > Source: GitHub Actions"
fi

log "triggering the deploy"
gh workflow run pages.yml --ref "$BRANCH" >/dev/null 2>&1 || warn "could not trigger; a push will do it"

log "waiting for the deploy (up to 5 minutes)"
URL="https://$(cut -d/ -f1 <<<"$SLUG").github.io/$(cut -d/ -f2 <<<"$SLUG")/"
for _ in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)"
  [ "$CODE" = "200" ] && { log "live: $URL"; exit 0; }
  sleep 10
done

warn "not serving yet — deploys can take a few minutes on a new site"
echo "  check:  gh run list --workflow=pages.yml"
echo "  url  :  $URL"
