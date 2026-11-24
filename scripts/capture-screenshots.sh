#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
command -v agent-browser >/dev/null || {
  echo "agent-browser is required: https://github.com/vercel-labs/agent-browser" >&2
  exit 1
}

session=$(agent-browser session id --scope worktree --prefix inbox-screenshots)
page="file://$root/art/demo.html"
ab() { agent-browser --session "$session" "$@"; }
trap 'ab close >/dev/null 2>&1 || true' EXIT

ab open "$page?scene=inbox" >/dev/null
ab set viewport 1728 1080 >/dev/null
ab screenshot "$root/preview.png" >/dev/null
ab screenshot .sidebar "$root/screenshots/inbox-sidebar.png" >/dev/null

for scene in actions children retained agents; do
  ab open "$page?scene=$scene" >/dev/null
  case "$scene" in
    actions) output=triage-actions.png ;;
    children) output=managed-children.png ;;
    retained) output=retained-transcript.png ;;
    agents) output=agents-view.png ;;
  esac
  ab screenshot "$root/screenshots/$output" >/dev/null
done

echo "Captured synthetic demo screenshots."
