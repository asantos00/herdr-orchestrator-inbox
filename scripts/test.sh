#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

node --test "$root"/mods/orchestrator-inbox/*.test.mjs
python3 -m json.tool "$root/layouts/orchestrator-inbox.json" >/dev/null
python3 -m json.tool "$root/keys.json" >/dev/null
python3 -m json.tool "$root/mods/orchestrator-inbox/mod.json" >/dev/null
python3 -m json.tool "$root/mods/orchestrator-workspace-chrome/mod.json" >/dev/null

for mod in orchestrator-inbox orchestrator-workspace-chrome; do
  if command -v herdr-app >/dev/null 2>&1; then
    herdr-app check "$root/mods/$mod"
  fi
done

"$root/scripts/test-install.sh"

echo "all checks passed"
